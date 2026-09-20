// golive-videocap — screen capture encoded on the GPU, the way Discord does it.
//
// Why this exists
// ---------------
// A share through Chromium's own path costs, per frame: the capture copied
// from the GPU into system memory, handed across processes to the renderer,
// and then either encoded on the CPU (VP9/AV1, and H.264 without a hardware
// encoder) or uploaded back to the GPU to be encoded there. At 1080p60 that is
// two full-frame copies sixty times a second, at normal priority, competing
// with a game that is using every core and the whole GPU. The share stutters
// while the game is in front and runs fine the moment it is not.
//
// This program keeps the frame on the GPU from start to finish:
//
//   Desktop Duplication (a monitor) or
//   Windows Graphics Capture (a window) ->  ID3D11Texture2D (BGRA)
//   ID3D11VideoProcessor      ->  ID3D11Texture2D (NV12), scaled
//   Media Foundation H.264    ->  the hardware encoder (NVENC, AMF, QuickSync)
//                                 reading that texture directly
//
// and writes only the compressed result to stdout — about a megabyte a second
// instead of hundreds. It also runs above normal priority, on the CPU and in
// the GPU scheduler, so the game in front does not starve it.
//
// The renderer does not decode any of this. It hands the H.264 to WebRTC as it
// is, in place of the frames of a tiny stand-in track (see
// lib/nativeVideoCapture.ts), so the peers receive this program's stream while
// every other part of the call — signalling, congestion control, the relay
// tree — is exactly what it always was.
//
// Separate executable for the same reasons as golive-audiocap (see the header
// of audiocap.cpp): no Electron ABI to match, a driver crash takes down this
// process and not the call, and the real-time work runs at its own priority.
//
// Interface
// ---------
//   golive-videocap.exe --probe
//       exit 0 and "OK <encoder name>" on stdout when this machine has both
//       Windows Graphics Capture and a hardware H.264 encoder; exit 3 when not.
//
//   golive-videocap.exe (--window <hwnd> | --monitor <x> <y>)
//                       --max-width <px> --max-height <px> --fps <n>
//                       --bitrate <kbps> [--cursor 0|1]
//                       [--capture-method duplication|wgc]
//       --capture-method picks how a monitor is captured: Desktop Duplication
//       (the default; no frame drawn around the screen) or Windows Graphics
//       Capture. A window is always captured with Graphics Capture.
//       --monitor takes a point in physical screen pixels; the monitor that
//       contains it is captured.
//
//   stdout  one record per encoded frame (see WriteFrame): a 24-byte
//           little-endian header, then the frame as Annex B H.264. Every IDR
//           carries its SPS and PPS.
//   stderr  "READY <width> <height> <encoder name>" once frames can flow;
//           otherwise diagnostics.
//   stdin   text commands, one per line: "bitrate <kbps>", "key".
//           Closing stdin is the shutdown signal.
//
//   exit 0  stopped through stdin
//   exit 2  bad arguments
//   exit 3  unsupported here (no Graphics Capture, no hardware encoder)
//   exit 4  the captured window or monitor went away
//   exit 1  anything else

#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <unknwn.h>
#include <inspectable.h>
#include <d3d11_4.h>
#include <dxgi1_6.h>
#include <mfapi.h>
#include <mferror.h>
#include <mfidl.h>
#include <mftransform.h>
// ICodecAPI is declared with the DirectShow interfaces, not beside its GUIDs.
#include <strmif.h>
#include <codecapi.h>
#include <avrt.h>
#include <d2d1_1.h>

#include <fcntl.h>
#include <io.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>

#include <algorithm>
#include <atomic>
#include <cstdint>
#include <cstring>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

// windows.h defines GetCurrentTime as a macro, and C++/WinRT has a member of
// that name; the two cannot meet.
#undef GetCurrentTime
#include <winrt/base.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Graphics.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>
#include <winrt/Windows.Security.Authorization.AppCapabilityAccess.h>
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>

namespace wgc = winrt::Windows::Graphics::Capture;
namespace wgd = winrt::Windows::Graphics::DirectX;

static const int EXIT_OK = 0;
static const int EXIT_FAILED = 1;
static const int EXIT_BAD_ARGS = 2;
static const int EXIT_UNSUPPORTED = 3;
static const int EXIT_TARGET_GONE = 4;

// The GPU scheduler's priority classes, from d3dkmthk.h. Declared here rather
// than including that header, which drags in kernel-mode types the rest of
// this file has no use for. Exported by gdi32.dll.
extern "C" LONG WINAPI D3DKMTSetProcessSchedulingPriorityClass(HANDLE process, INT priority);
static const INT D3DKMT_PRIORITY_HIGH = 4;

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

static std::mutex g_stdoutMutex;
// Where frames got to, for the one diagnostic that matters when a share shows
// nothing: which stage they stopped at (see WatchProgress).
static std::atomic<uint32_t> g_framesArrived{0};
static std::atomic<uint32_t> g_framesConverted{0};
static std::atomic<uint32_t> g_needInputEvents{0};
static std::atomic<uint32_t> g_inputsAccepted{0};
static std::atomic<uint32_t> g_inputsRefused{0};
static std::atomic<uint32_t> g_framesEncoded{0};
static std::atomic<long> g_lastInputError{0};
static HANDLE g_stdout = INVALID_HANDLE_VALUE;
static HANDLE g_quit = nullptr;
static std::atomic<int> g_exitCode{EXIT_OK};

static void Log(const char* format, ...) {
  char line[1024];
  va_list args;
  va_start(args, format);
  vsnprintf(line, sizeof(line), format, args);
  va_end(args);
  fputs(line, stderr);
  fputc('\n', stderr);
  fflush(stderr);
}

// Ends the process's work with `code`, from any thread. The first caller wins:
// a window that closed is reported as that, not as whatever failure its
// teardown caused next.
static void Finish(int code) {
  int expected = EXIT_OK;
  if (code != EXIT_OK) g_exitCode.compare_exchange_strong(expected, code);
  if (g_quit) SetEvent(g_quit);
}

static bool WriteAll(const void* data, DWORD size) {
  const BYTE* p = static_cast<const BYTE*>(data);
  while (size > 0) {
    DWORD written = 0;
    if (!WriteFile(g_stdout, p, size, &written, nullptr) || written == 0) return false;
    p += written;
    size -= written;
  }
  return true;
}

// The record the shell reads (see FRAME_HEADER_BYTES in
// electron/nativeVideo.ts, which must agree):
//
//   0  u32  magic "GLVF"
//   4  u32  payload length
//   8  u32  flags (bit 0: IDR)
//  12  u32  sequence number
//  16  u16  width
//  18  u16  height
//  20  u32  capture time, milliseconds since start
static void WriteFrame(const std::vector<BYTE>& payload, bool key, uint32_t sequence, int width, int height,
                       uint32_t timeMs) {
  BYTE header[24];
  const uint32_t magic = 0x46564C47;  // "GLVF" read little-endian
  const uint32_t length = static_cast<uint32_t>(payload.size());
  const uint32_t flags = key ? 1u : 0u;
  const uint16_t w = static_cast<uint16_t>(width);
  const uint16_t h = static_cast<uint16_t>(height);
  memcpy(header + 0, &magic, 4);
  memcpy(header + 4, &length, 4);
  memcpy(header + 8, &flags, 4);
  memcpy(header + 12, &sequence, 4);
  memcpy(header + 16, &w, 2);
  memcpy(header + 18, &h, 2);
  memcpy(header + 20, &timeMs, 4);
  std::lock_guard<std::mutex> lock(g_stdoutMutex);
  // A closed stdout is the shell gone. Nothing left to capture for.
  if (!WriteAll(header, sizeof(header)) || !WriteAll(payload.data(), length)) Finish(EXIT_OK);
}

// ---------------------------------------------------------------------------
// Annex B
// ---------------------------------------------------------------------------

struct NalUnit {
  size_t start;  // at the start code
  size_t end;
  int type;
};

static std::vector<NalUnit> SplitNalUnits(const BYTE* data, size_t size) {
  std::vector<NalUnit> units;
  size_t i = 0;
  size_t current = SIZE_MAX;
  while (i + 3 <= size) {
    if (data[i] == 0 && data[i + 1] == 0 && data[i + 2] == 1) {
      size_t codeStart = (i > 0 && data[i - 1] == 0) ? i - 1 : i;
      if (current != SIZE_MAX) units.back().end = codeStart;
      size_t header = i + 3;
      units.push_back({codeStart, size, header < size ? (data[header] & 0x1f) : 0});
      current = codeStart;
      i = header;
    } else {
      ++i;
    }
  }
  return units;
}

// Receivers cannot start on an IDR whose parameter sets they have not seen,
// and hardware encoders put them only on the first one. Every IDR leaves here
// with them, so any IDR is a place a viewer can join.
class ParameterSets {
 public:
  // Returns whether the access unit holds an IDR slice.
  bool Process(std::vector<BYTE>& au) {
    std::vector<NalUnit> units = SplitNalUnits(au.data(), au.size());
    bool idr = false, hasSps = false, hasPps = false;
    for (const NalUnit& u : units) {
      if (u.type == 5) idr = true;
      if (u.type == 7) {
        sps_.assign(au.begin() + u.start, au.begin() + u.end);
        hasSps = true;
      }
      if (u.type == 8) {
        pps_.assign(au.begin() + u.start, au.begin() + u.end);
        hasPps = true;
      }
    }
    if (!idr || (hasSps && hasPps) || sps_.empty() || pps_.empty()) return idr;
    // After an access unit delimiter if there is one, before everything else.
    size_t at = 0;
    for (const NalUnit& u : units) {
      if (u.type == 9) {
        at = u.end;
        continue;
      }
      break;
    }
    std::vector<BYTE> out;
    out.reserve(au.size() + sps_.size() + pps_.size());
    out.insert(out.end(), au.begin(), au.begin() + at);
    out.insert(out.end(), sps_.begin(), sps_.end());
    out.insert(out.end(), pps_.begin(), pps_.end());
    out.insert(out.end(), au.begin() + at, au.end());
    au.swap(out);
    return true;
  }

 private:
  std::vector<BYTE> sps_;
  std::vector<BYTE> pps_;
};

// ---------------------------------------------------------------------------
// NV12 textures the encoder reads from
// ---------------------------------------------------------------------------

class TexturePool {
 public:
  bool Init(ID3D11Device* device, ID3D11VideoDevice* video, ID3D11VideoProcessorEnumerator* enumerator, int width,
            int height, int count) {
    std::lock_guard<std::mutex> lock(mutex_);
    textures_.clear();
    views_.clear();
    busy_.clear();
    D3D11_TEXTURE2D_DESC desc = {};
    desc.Width = width;
    desc.Height = height;
    desc.MipLevels = 1;
    desc.ArraySize = 1;
    desc.Format = DXGI_FORMAT_NV12;
    desc.SampleDesc.Count = 1;
    desc.Usage = D3D11_USAGE_DEFAULT;
    desc.BindFlags = D3D11_BIND_RENDER_TARGET;
    for (int i = 0; i < count; ++i) {
      winrt::com_ptr<ID3D11Texture2D> texture;
      if (FAILED(device->CreateTexture2D(&desc, nullptr, texture.put()))) return false;
      winrt::com_ptr<ID3D11VideoProcessorOutputView> view;
      D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC viewDesc = {};
      viewDesc.ViewDimension = D3D11_VPOV_DIMENSION_TEXTURE2D;
      if (FAILED(video->CreateVideoProcessorOutputView(texture.get(), enumerator, &viewDesc, view.put()))) {
        return false;
      }
      textures_.push_back(texture);
      views_.push_back(view);
      busy_.push_back(false);
    }
    return true;
  }

  // -1 when every texture is still with the encoder — it is behind, and the
  // frame is better skipped than queued.
  int Acquire() {
    std::lock_guard<std::mutex> lock(mutex_);
    for (size_t i = 0; i < busy_.size(); ++i) {
      if (!busy_[i]) {
        busy_[i] = true;
        return static_cast<int>(i);
      }
    }
    return -1;
  }

  void Release(int index) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (index >= 0 && index < static_cast<int>(busy_.size())) busy_[index] = false;
  }

  ID3D11Texture2D* Texture(int index) { return textures_[index].get(); }
  ID3D11VideoProcessorOutputView* View(int index) { return views_[index].get(); }

 private:
  std::mutex mutex_;
  std::vector<winrt::com_ptr<ID3D11Texture2D>> textures_;
  std::vector<winrt::com_ptr<ID3D11VideoProcessorOutputView>> views_;
  std::vector<bool> busy_;
};

// Hands a texture back to the pool once Media Foundation has let go of the
// sample wrapping it (IMFTrackedSample), which is the only moment it is
// certainly no longer being read.
class ReturnToPool : public IMFAsyncCallback {
 public:
  ReturnToPool(TexturePool* pool, int index) : pool_(pool), index_(index) {}

  STDMETHODIMP QueryInterface(REFIID riid, void** object) override {
    if (!object) return E_POINTER;
    if (riid == __uuidof(IUnknown) || riid == __uuidof(IMFAsyncCallback)) {
      *object = static_cast<IMFAsyncCallback*>(this);
      AddRef();
      return S_OK;
    }
    *object = nullptr;
    return E_NOINTERFACE;
  }
  STDMETHODIMP_(ULONG) AddRef() override { return InterlockedIncrement(&ref_); }
  STDMETHODIMP_(ULONG) Release() override {
    ULONG count = InterlockedDecrement(&ref_);
    if (count == 0) delete this;
    return count;
  }
  STDMETHODIMP GetParameters(DWORD*, DWORD*) override { return E_NOTIMPL; }
  STDMETHODIMP Invoke(IMFAsyncResult*) override {
    pool_->Release(index_);
    return S_OK;
  }

 private:
  LONG ref_ = 1;
  TexturePool* pool_;
  int index_;
};

// ---------------------------------------------------------------------------
// Encoder
// ---------------------------------------------------------------------------

static void SetCodecValue(ICodecAPI* codec, const GUID& key, UINT32 value) {
  VARIANT v;
  VariantInit(&v);
  v.vt = VT_UI4;
  v.ulVal = value;
  codec->SetValue(&key, &v);
}

static void SetCodecBool(ICodecAPI* codec, const GUID& key, bool value) {
  VARIANT v;
  VariantInit(&v);
  v.vt = VT_BOOL;
  v.boolVal = value ? VARIANT_TRUE : VARIANT_FALSE;
  codec->SetValue(&key, &v);
}

// The hardware H.264 encoders on one adapter.
static std::vector<winrt::com_ptr<IMFActivate>> FindHardwareEncoders(const LUID* adapter) {
  std::vector<winrt::com_ptr<IMFActivate>> found;
  MFT_REGISTER_TYPE_INFO input = {MFMediaType_Video, MFVideoFormat_NV12};
  MFT_REGISTER_TYPE_INFO output = {MFMediaType_Video, MFVideoFormat_H264};
  winrt::com_ptr<IMFAttributes> attributes;
  if (adapter) {
    if (FAILED(MFCreateAttributes(attributes.put(), 1))) return found;
    attributes->SetBlob(MFT_ENUM_ADAPTER_LUID, reinterpret_cast<const UINT8*>(adapter), sizeof(LUID));
  }
  IMFActivate** list = nullptr;
  UINT32 count = 0;
  HRESULT hr = MFTEnum2(MFT_CATEGORY_VIDEO_ENCODER, MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER, &input,
                        &output, attributes.get(), &list, &count);
  if (FAILED(hr)) return found;
  for (UINT32 i = 0; i < count; ++i) {
    winrt::com_ptr<IMFActivate> activate;
    activate.attach(list[i]);
    found.push_back(activate);
  }
  CoTaskMemFree(list);
  return found;
}

static std::string FriendlyName(IMFActivate* activate) {
  wchar_t* name = nullptr;
  UINT32 length = 0;
  if (FAILED(activate->GetAllocatedString(MFT_FRIENDLY_NAME_Attribute, &name, &length)) || !name) {
    return "hardware H.264 encoder";
  }
  int bytes = WideCharToMultiByte(CP_UTF8, 0, name, -1, nullptr, 0, nullptr, nullptr);
  std::string out(bytes > 0 ? bytes - 1 : 0, '\0');
  if (bytes > 1) WideCharToMultiByte(CP_UTF8, 0, name, -1, &out[0], bytes, nullptr, nullptr);
  CoTaskMemFree(name);
  return out;
}

class Encoder {
 public:
  Encoder(TexturePool* pool) : pool_(pool) {}

  bool Init(IMFActivate* activate, ID3D11Device* device, int width, int height, int fps, int kbps) {
    width_ = width;
    height_ = height;
    fps_ = fps;
    HRESULT hr = activate->ActivateObject(__uuidof(IMFTransform), transform_.put_void());
    if (FAILED(hr)) return Fail("ActivateObject", hr);

    winrt::com_ptr<IMFAttributes> attributes;
    if (FAILED(transform_->GetAttributes(attributes.put()))) return Fail("GetAttributes", E_FAIL);
    UINT32 async = FALSE;
    attributes->GetUINT32(MF_TRANSFORM_ASYNC, &async);
    // Every hardware encoder is asynchronous by the platform's own rules; one
    // that is not is something this program was never tested against.
    if (!async) return Fail("encoder is not asynchronous", E_NOTIMPL);
    attributes->SetUINT32(MF_TRANSFORM_ASYNC_UNLOCK, TRUE);
    attributes->SetUINT32(MF_LOW_LATENCY, TRUE);

    DWORD inputs = 0, outputs = 0;
    transform_->GetStreamCount(&inputs, &outputs);
    if (inputs != 1 || outputs != 1) return Fail("unexpected stream count", E_FAIL);
    DWORD inputId = 0, outputId = 0;
    hr = transform_->GetStreamIDs(1, &inputId, 1, &outputId);
    if (SUCCEEDED(hr)) {
      inputId_ = inputId;
      outputId_ = outputId;
    }

    UINT token = 0;
    hr = MFCreateDXGIDeviceManager(&token, manager_.put());
    if (FAILED(hr)) return Fail("MFCreateDXGIDeviceManager", hr);
    hr = manager_->ResetDevice(device, token);
    if (FAILED(hr)) return Fail("ResetDevice", hr);
    hr = transform_->ProcessMessage(MFT_MESSAGE_SET_D3D_MANAGER, reinterpret_cast<ULONG_PTR>(manager_.get()));
    if (FAILED(hr)) return Fail("SET_D3D_MANAGER", hr);

    // Output type first: an encoder decides which inputs it takes from it.
    // Constrained Baseline is what every WebRTC receiver is guaranteed to
    // decode; the others are fallbacks for an encoder that refuses it, and
    // are asked for without B-frames below.
    const UINT32 profiles[] = {eAVEncH264VProfile_ConstrainedBase, eAVEncH264VProfile_Base, eAVEncH264VProfile_Main};
    bool outputSet = false;
    for (UINT32 profile : profiles) {
      winrt::com_ptr<IMFMediaType> type;
      MFCreateMediaType(type.put());
      type->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
      type->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_H264);
      type->SetUINT32(MF_MT_AVG_BITRATE, static_cast<UINT32>(kbps) * 1000);
      MFSetAttributeSize(type.get(), MF_MT_FRAME_SIZE, width, height);
      MFSetAttributeRatio(type.get(), MF_MT_FRAME_RATE, fps, 1);
      MFSetAttributeRatio(type.get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1);
      type->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
      type->SetUINT32(MF_MT_MPEG2_PROFILE, profile);
      if (SUCCEEDED(transform_->SetOutputType(outputId_, type.get(), 0))) {
        outputSet = true;
        break;
      }
    }
    if (!outputSet) return Fail("SetOutputType", E_FAIL);

    if (!SetInputType()) return Fail("SetInputType", E_FAIL);

    codec_ = transform_.try_as<ICodecAPI>();
    if (codec_) {
      // Each of these is best effort: an encoder that does not know one keeps
      // its own default, and none of them is worth failing the share over.
      SetCodecValue(codec_.get(), CODECAPI_AVEncCommonRateControlMode, eAVEncCommonRateControlMode_CBR);
      SetCodecValue(codec_.get(), CODECAPI_AVEncCommonMeanBitRate, static_cast<UINT32>(kbps) * 1000);
      appliedKbps_ = kbps;
      SetCodecBool(codec_.get(), CODECAPI_AVLowLatencyMode, true);
      SetCodecValue(codec_.get(), CODECAPI_AVEncMPVDefaultBPictureCount, 0);
      // An IDR every few seconds on its own, so a viewer whose keyframe
      // request was lost still recovers. Requests (ForceKey) come on top.
      SetCodecValue(codec_.get(), CODECAPI_AVEncMPVGOPSize, static_cast<UINT32>(fps) * 4);
      // Speed over quality: the whole point is to take as little from the
      // GPU as a game will spare.
      SetCodecValue(codec_.get(), CODECAPI_AVEncCommonQualityVsSpeed, 33);
    }

    events_ = transform_.try_as<IMFMediaEventGenerator>();
    if (!events_) return Fail("no event generator", E_NOINTERFACE);

    MFT_OUTPUT_STREAM_INFO info = {};
    transform_->GetOutputStreamInfo(outputId_, &info);
    providesSamples_ = (info.dwFlags & (MFT_OUTPUT_STREAM_PROVIDES_SAMPLES | MFT_OUTPUT_STREAM_CAN_PROVIDE_SAMPLES)) != 0;
    outputBufferSize_ = info.cbSize ? info.cbSize : static_cast<DWORD>(width) * height * 3 / 2;

    hr = transform_->ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0);
    if (FAILED(hr)) return Fail("BEGIN_STREAMING", hr);
    hr = transform_->ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0);
    if (FAILED(hr)) return Fail("START_OF_STREAM", hr);
    return true;
  }

  // Runs until the process is told to stop. On its own thread.
  void Run() {
    AvSetMmThreadCharacteristicsW(L"Capture", &mmcssTask_);
    for (;;) {
      ApplyPendingBitrate();
      winrt::com_ptr<IMFMediaEvent> event;
      HRESULT hr = events_->GetEvent(0, event.put());
      if (FAILED(hr)) {
        if (!stopping_) {
          Log("encoder event failed: 0x%08lx", hr);
          Finish(EXIT_FAILED);
        }
        return;
      }
      MediaEventType type = MEUnknown;
      event->GetType(&type);
      if (type == METransformNeedInput) {
        OnNeedInput();
      } else if (type == METransformHaveOutput) {
        OnHaveOutput();
      } else if (type == MEError) {
        HRESULT status = S_OK;
        event->GetStatus(&status);
        Log("encoder error: 0x%08lx", status);
        Finish(EXIT_FAILED);
        return;
      }
    }
  }

  // Takes pool texture `index`, which is returned to the pool once encoded
  // (or here, if it never reaches the encoder).
  void Submit(int index, LONGLONG time100ns) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (needInput_ > 0) {
      --needInput_;
      ProcessInputLocked(index, time100ns);
      return;
    }
    // Not asked for input yet: keep only the newest frame waiting.
    if (pendingIndex_ >= 0) pool_->Release(pendingIndex_);
    pendingIndex_ = index;
    pendingTime_ = time100ns;
  }

  // The page sends one of these every couple of seconds. Neither may touch
  // the encoder from here.
  //
  // `mutex_` is the frame path: Capture::SubmitLocked takes it, and it does
  // so holding gpuMutex_ — the lock the duplication thread needs to take the
  // next frame off the screen. Anything slow under `mutex_` therefore stops
  // the capture itself, not just the encoder. And ICodecAPI::SetValue on a
  // live hardware encoder is slow: a bitrate change is a rate-control
  // reconfigure that sits inside the driver while it happens. A routine
  // bitrate nudge was freezing the picture, on the beat of the page's timer.
  //
  // So the bitrate is left here for the encoder's own thread to apply between
  // frames (see ApplyPendingBitrate), where a stall costs a dropped frame or
  // two and nothing upstream. The key-frame flag is not a reconfigure —
  // the encoder reads it when it starts the next frame — but it is asked for
  // several times a second by a room full of viewers, so it stays off
  // `mutex_` too, under a lock of its own that only codec calls contend for.
  void SetBitrate(int kbps) { pendingKbps_.store(kbps); }

  void ForceKey() {
    std::lock_guard<std::mutex> lock(codecMutex_);
    if (codec_) SetCodecValue(codec_.get(), CODECAPI_AVEncVideoForceKeyFrame, 1);
  }

  void Stop() {
    stopping_ = true;
    if (auto shutdown = transform_.try_as<IMFShutdown>()) shutdown->Shutdown();
  }

 private:
  bool Fail(const char* what, HRESULT hr) {
    Log("encoder init: %s failed (0x%08lx)", what, hr);
    return false;
  }

  // On the encoder thread, outside `mutex_`, and only for a rate that really
  // changed: repeating the one the encoder already has costs a reconfigure —
  // on most drivers a restarted rate controller and an unasked-for IDR — and
  // buys nothing.
  void ApplyPendingBitrate() {
    const int kbps = pendingKbps_.exchange(0);
    if (kbps <= 0 || kbps == appliedKbps_) return;
    appliedKbps_ = kbps;
    std::lock_guard<std::mutex> lock(codecMutex_);
    if (codec_) SetCodecValue(codec_.get(), CODECAPI_AVEncCommonMeanBitRate, static_cast<UINT32>(kbps) * 1000);
  }

  bool SetInputType() {
    auto describe = [&](IMFMediaType* type) {
      type->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
      type->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_NV12);
      MFSetAttributeSize(type, MF_MT_FRAME_SIZE, width_, height_);
      MFSetAttributeRatio(type, MF_MT_FRAME_RATE, fps_, 1);
      MFSetAttributeRatio(type, MF_MT_PIXEL_ASPECT_RATIO, 1, 1);
      type->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
      // What the video processor writes (see Capture::EnsureProcessor), so
      // the encoder puts it in the stream and receivers do not guess BT.601.
      type->SetUINT32(MF_MT_VIDEO_PRIMARIES, MFVideoPrimaries_BT709);
      type->SetUINT32(MF_MT_TRANSFER_FUNCTION, MFVideoTransFunc_709);
      type->SetUINT32(MF_MT_YUV_MATRIX, MFVideoTransferMatrix_BT709);
      type->SetUINT32(MF_MT_VIDEO_NOMINAL_RANGE, MFNominalRange_16_235);
    };
    winrt::com_ptr<IMFMediaType> type;
    MFCreateMediaType(type.put());
    describe(type.get());
    if (SUCCEEDED(transform_->SetInputType(inputId_, type.get(), 0))) return true;
    // Some encoders only accept a type they handed out themselves.
    for (DWORD i = 0;; ++i) {
      winrt::com_ptr<IMFMediaType> offered;
      if (FAILED(transform_->GetInputAvailableType(inputId_, i, offered.put()))) return false;
      GUID subtype = GUID_NULL;
      offered->GetGUID(MF_MT_SUBTYPE, &subtype);
      if (subtype != MFVideoFormat_NV12) continue;
      describe(offered.get());
      if (SUCCEEDED(transform_->SetInputType(inputId_, offered.get(), 0))) return true;
    }
  }

  void OnNeedInput() {
    std::lock_guard<std::mutex> lock(mutex_);
    if (pendingIndex_ >= 0) {
      int index = pendingIndex_;
      pendingIndex_ = -1;
      ProcessInputLocked(index, pendingTime_);
      return;
    }
    ++needInput_;
    g_needInputEvents++;
  }

  void ProcessInputLocked(int index, LONGLONG time100ns) {
    winrt::com_ptr<IMFMediaBuffer> buffer;
    HRESULT hr = MFCreateDXGISurfaceBuffer(__uuidof(ID3D11Texture2D), pool_->Texture(index), 0, FALSE, buffer.put());
    if (FAILED(hr)) {
      pool_->Release(index);
      return;
    }
    if (auto buffer2d = buffer.try_as<IMF2DBuffer>()) {
      DWORD length = 0;
      if (SUCCEEDED(buffer2d->GetContiguousLength(&length))) buffer->SetCurrentLength(length);
    }

    winrt::com_ptr<IMFSample> sample;
    winrt::com_ptr<IMFTrackedSample> tracked;
    bool trackedOk = SUCCEEDED(MFCreateTrackedSample(tracked.put()));
    if (trackedOk) {
      sample = tracked.try_as<IMFSample>();
      ReturnToPool* callback = new (std::nothrow) ReturnToPool(pool_, index);
      if (!sample || !callback || FAILED(tracked->SetAllocator(callback, nullptr))) {
        trackedOk = false;
        sample = nullptr;
      }
      if (callback) callback->Release();
    }
    if (!trackedOk) {
      // No way to hear when the encoder is done with the texture, so it is
      // handed back once the frame comes out the other end (see OnHaveOutput).
      if (FAILED(MFCreateSample(sample.put()))) {
        pool_->Release(index);
        return;
      }
      untracked_.push_back(index);
    }
    sample->AddBuffer(buffer.get());
    sample->SetSampleTime(time100ns);
    sample->SetSampleDuration(10000000LL / fps_);
    hr = transform_->ProcessInput(inputId_, sample.get(), 0);
    if (SUCCEEDED(hr)) g_inputsAccepted++;
    if (FAILED(hr)) {
      g_inputsRefused++;
      g_lastInputError = hr;
      if (hr != MF_E_NOTACCEPTING) Log("ProcessInput: 0x%08lx", hr);
      if (!trackedOk && !untracked_.empty()) {
        untracked_.pop_back();
        pool_->Release(index);
      }
      // A tracked sample returns its texture as it is released below.
    }
  }

  void OnHaveOutput() {
    std::unique_lock<std::mutex> lock(mutex_);
    MFT_OUTPUT_DATA_BUFFER output = {};
    output.dwStreamID = outputId_;
    winrt::com_ptr<IMFSample> own;
    if (!providesSamples_) {
      winrt::com_ptr<IMFMediaBuffer> buffer;
      if (FAILED(MFCreateSample(own.put())) || FAILED(MFCreateMemoryBuffer(outputBufferSize_, buffer.put()))) return;
      own->AddBuffer(buffer.get());
      output.pSample = own.get();
    }
    DWORD status = 0;
    HRESULT hr = transform_->ProcessOutput(0, 1, &output, &status);
    if (output.pEvents) output.pEvents->Release();
    winrt::com_ptr<IMFSample> sample;
    if (providesSamples_) sample.attach(output.pSample);
    else sample = own;

    if (hr == MF_E_TRANSFORM_STREAM_CHANGE) {
      winrt::com_ptr<IMFMediaType> type;
      if (SUCCEEDED(transform_->GetOutputAvailableType(outputId_, 0, type.put()))) {
        transform_->SetOutputType(outputId_, type.get(), 0);
      }
      return;
    }
    if (FAILED(hr) || !sample) return;

    if (!untracked_.empty()) {
      pool_->Release(untracked_.front());
      untracked_.erase(untracked_.begin());
    }

    winrt::com_ptr<IMFMediaBuffer> buffer;
    if (FAILED(sample->ConvertToContiguousBuffer(buffer.put()))) return;
    BYTE* data = nullptr;
    DWORD length = 0;
    if (FAILED(buffer->Lock(&data, nullptr, &length))) return;
    std::vector<BYTE> au(data, data + length);
    buffer->Unlock();
    if (au.empty()) return;

    LONGLONG time = 0;
    sample->GetSampleTime(&time);

    // Out from under `mutex_` for the rest. WriteFrame blocks in WriteFile
    // until the shell has drained the pipe, and a pipe holds 64 KB while an
    // IDR at 1080p is several times that — so every key frame waits on
    // Electron's main thread getting round to reading it. Held, that wait
    // stopped the encoder being fed *and*, through Submit, the capture thread
    // that was holding gpuMutex_: a reader a few milliseconds late became a
    // frozen picture. Unlocked, the frames behind it simply pile into the
    // texture pool and the oldest are skipped, which is the backpressure this
    // pipeline was built with.
    //
    // Safe to leave the lock: parameterSets_ and sequence_ are touched on
    // this thread alone, and g_stdoutMutex keeps the records whole.
    lock.unlock();
    bool key = parameterSets_.Process(au);
    g_framesEncoded++;
    WriteFrame(au, key, sequence_++, width_, height_, static_cast<uint32_t>(time / 10000));
  }

  TexturePool* pool_;
  winrt::com_ptr<IMFTransform> transform_;
  winrt::com_ptr<IMFMediaEventGenerator> events_;
  winrt::com_ptr<ICodecAPI> codec_;
  winrt::com_ptr<IMFDXGIDeviceManager> manager_;
  DWORD inputId_ = 0;
  DWORD outputId_ = 0;
  bool providesSamples_ = true;
  DWORD outputBufferSize_ = 0;
  int width_ = 0, height_ = 0, fps_ = 30;
  std::mutex mutex_;
  // Codec configuration only, so a driver that takes its time over a
  // reconfigure cannot reach the frame path through `mutex_`.
  std::mutex codecMutex_;
  std::atomic<int> pendingKbps_{0};
  int appliedKbps_ = 0;  // Init, and after that the encoder thread alone.
  int needInput_ = 0;
  int pendingIndex_ = -1;
  LONGLONG pendingTime_ = 0;
  std::vector<int> untracked_;
  ParameterSets parameterSets_;
  uint32_t sequence_ = 0;
  DWORD mmcssTask_ = 0;
  std::atomic<bool> stopping_{false};
};

// ---------------------------------------------------------------------------
// Cursor
// ---------------------------------------------------------------------------

// Desktop Duplication hands over the desktop without the mouse pointer, so it
// is drawn in here — with Direct2D, on the same device, so the frame still
// never leaves the GPU. The shape comes from the cursor handle itself; a
// monochrome cursor's "invert" pixels (the text I-beam) are drawn black,
// which is what they look like on the light backgrounds they are used on.
class CursorOverlay {
 public:
  bool Init(ID3D11Device* device) {
    if (FAILED(D2D1CreateFactory(D2D1_FACTORY_TYPE_MULTI_THREADED, factory_.put()))) return false;
    winrt::com_ptr<IDXGIDevice> dxgi;
    if (FAILED(device->QueryInterface(__uuidof(IDXGIDevice), dxgi.put_void()))) return false;
    winrt::com_ptr<ID2D1Device> d2d;
    if (FAILED(factory_->CreateDevice(dxgi.get(), d2d.put()))) return false;
    return SUCCEEDED(d2d->CreateDeviceContext(D2D1_DEVICE_CONTEXT_OPTIONS_NONE, context_.put()));
  }

  /** The texture drawn into was replaced. */
  void Invalidate() { target_ = nullptr; }

  void Draw(ID3D11Texture2D* texture, const RECT& monitor) {
    if (!context_) return;
    CURSORINFO info = {};
    info.cbSize = sizeof(info);
    if (!GetCursorInfo(&info) || !(info.flags & CURSOR_SHOWING) || !info.hCursor) return;
    if (info.hCursor != shape_) {
      shape_ = info.hCursor;
      bitmap_ = nullptr;
      Build(info.hCursor);
    }
    if (!bitmap_) return;
    if (!target_) {
      winrt::com_ptr<IDXGISurface> surface;
      if (FAILED(texture->QueryInterface(__uuidof(IDXGISurface), surface.put_void()))) return;
      D2D1_BITMAP_PROPERTIES1 props = D2D1::BitmapProperties1(
          D2D1_BITMAP_OPTIONS_TARGET | D2D1_BITMAP_OPTIONS_CANNOT_DRAW,
          D2D1::PixelFormat(DXGI_FORMAT_B8G8R8A8_UNORM, D2D1_ALPHA_MODE_IGNORE));
      if (FAILED(context_->CreateBitmapFromDxgiSurface(surface.get(), &props, target_.put()))) return;
    }
    const FLOAT x = static_cast<FLOAT>(info.ptScreenPos.x - monitor.left - hotX_);
    const FLOAT y = static_cast<FLOAT>(info.ptScreenPos.y - monitor.top - hotY_);
    D2D1_RECT_F dest = D2D1::RectF(x, y, x + width_, y + height_);
    context_->SetTarget(target_.get());
    context_->BeginDraw();
    context_->DrawBitmap(bitmap_.get(), &dest, 1.0f, D2D1_INTERPOLATION_MODE_NEAREST_NEIGHBOR, nullptr, nullptr);
    HRESULT hr = context_->EndDraw();
    context_->SetTarget(nullptr);
    if (FAILED(hr)) target_ = nullptr;
  }

 private:
  void Build(HCURSOR cursor) {
    ICONINFO icon = {};
    if (!GetIconInfo(cursor, &icon)) return;
    HDC dc = GetDC(nullptr);
    auto read = [dc](HBITMAP bitmap, int width, int height, std::vector<BYTE>& out) {
      BITMAPINFO bi = {};
      bi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
      bi.bmiHeader.biWidth = width;
      bi.bmiHeader.biHeight = -height;  // top-down
      bi.bmiHeader.biPlanes = 1;
      bi.bmiHeader.biBitCount = 32;
      bi.bmiHeader.biCompression = BI_RGB;
      out.assign(static_cast<size_t>(width) * height * 4, 0);
      return GetDIBits(dc, bitmap, 0, height, out.data(), &bi, DIB_RGB_COLORS) == height;
    };

    std::vector<BYTE> pixels;
    int width = 0, height = 0;
    BITMAP bm = {};
    if (icon.hbmColor && GetObject(icon.hbmColor, sizeof(bm), &bm)) {
      width = bm.bmWidth;
      height = bm.bmHeight;
      if (read(icon.hbmColor, width, height, pixels)) {
        bool hasAlpha = false;
        for (size_t p = 3; p < pixels.size(); p += 4) {
          if (pixels[p]) {
            hasAlpha = true;
            break;
          }
        }
        // An old-style colour cursor: its transparency is in the mask.
        std::vector<BYTE> mask;
        if (!hasAlpha && icon.hbmMask && read(icon.hbmMask, width, height, mask)) {
          for (size_t p = 0; p + 3 < pixels.size(); p += 4) pixels[p + 3] = mask[p] > 127 ? 0 : 255;
        }
      } else {
        pixels.clear();
      }
    } else if (icon.hbmMask && GetObject(icon.hbmMask, sizeof(bm), &bm)) {
      // Monochrome: the mask is twice as tall, AND bits above XOR bits.
      width = bm.bmWidth;
      height = bm.bmHeight / 2;
      std::vector<BYTE> mask;
      if (height > 0 && read(icon.hbmMask, width, height * 2, mask)) {
        pixels.assign(static_cast<size_t>(width) * height * 4, 0);
        for (int y = 0; y < height; ++y) {
          for (int x = 0; x < width; ++x) {
            const bool andBit = mask[(static_cast<size_t>(y) * width + x) * 4] > 127;
            const bool xorBit = mask[(static_cast<size_t>(y + height) * width + x) * 4] > 127;
            const size_t p = (static_cast<size_t>(y) * width + x) * 4;
            if (!andBit) {
              const BYTE v = xorBit ? 255 : 0;
              pixels[p] = pixels[p + 1] = pixels[p + 2] = v;
              pixels[p + 3] = 255;
            } else if (xorBit) {
              pixels[p + 3] = 255;  // "invert", drawn black
            }
          }
        }
      }
    }
    ReleaseDC(nullptr, dc);
    if (icon.hbmColor) DeleteObject(icon.hbmColor);
    if (icon.hbmMask) DeleteObject(icon.hbmMask);
    if (pixels.empty() || width <= 0 || height <= 0) return;

    for (size_t p = 0; p + 3 < pixels.size(); p += 4) {
      const UINT a = pixels[p + 3];
      pixels[p] = static_cast<BYTE>(pixels[p] * a / 255);
      pixels[p + 1] = static_cast<BYTE>(pixels[p + 1] * a / 255);
      pixels[p + 2] = static_cast<BYTE>(pixels[p + 2] * a / 255);
    }
    D2D1_BITMAP_PROPERTIES1 props = D2D1::BitmapProperties1(
        D2D1_BITMAP_OPTIONS_NONE, D2D1::PixelFormat(DXGI_FORMAT_B8G8R8A8_UNORM, D2D1_ALPHA_MODE_PREMULTIPLIED));
    if (FAILED(context_->CreateBitmap(D2D1::SizeU(width, height), pixels.data(), width * 4, &props, bitmap_.put()))) {
      bitmap_ = nullptr;
      return;
    }
    width_ = static_cast<FLOAT>(width);
    height_ = static_cast<FLOAT>(height);
    hotX_ = static_cast<LONG>(icon.xHotspot);
    hotY_ = static_cast<LONG>(icon.yHotspot);
  }

  winrt::com_ptr<ID2D1Factory1> factory_;
  winrt::com_ptr<ID2D1DeviceContext> context_;
  winrt::com_ptr<ID2D1Bitmap1> target_;
  winrt::com_ptr<ID2D1Bitmap1> bitmap_;
  HCURSOR shape_ = nullptr;
  FLOAT width_ = 0, height_ = 0;
  LONG hotX_ = 0, hotY_ = 0;
};

// The DXGI output showing `monitor`, if it is on this device's adapter —
// Desktop Duplication only works from a device on the adapter the monitor
// is connected to.
static winrt::com_ptr<IDXGIOutput1> FindOutput(ID3D11Device* device, HMONITOR monitor, RECT* rect) {
  winrt::com_ptr<IDXGIDevice> dxgi;
  if (FAILED(device->QueryInterface(__uuidof(IDXGIDevice), dxgi.put_void()))) return nullptr;
  winrt::com_ptr<IDXGIAdapter> adapter;
  if (FAILED(dxgi->GetAdapter(adapter.put()))) return nullptr;
  for (UINT i = 0;; ++i) {
    winrt::com_ptr<IDXGIOutput> output;
    if (adapter->EnumOutputs(i, output.put()) == DXGI_ERROR_NOT_FOUND) return nullptr;
    DXGI_OUTPUT_DESC desc;
    if (FAILED(output->GetDesc(&desc)) || desc.Monitor != monitor) continue;
    *rect = desc.DesktopCoordinates;
    return output.try_as<IDXGIOutput1>();
  }
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

static LONGLONG Now100ns() {
  static LARGE_INTEGER frequency = [] {
    LARGE_INTEGER f;
    QueryPerformanceFrequency(&f);
    return f;
  }();
  LARGE_INTEGER counter;
  QueryPerformanceCounter(&counter);
  return static_cast<LONGLONG>(counter.QuadPart * 10000000.0 / frequency.QuadPart);
}

class Capture {
 public:
  Capture(ID3D11Device* device, TexturePool* pool, Encoder* encoder) : device_(), pool_(pool), encoder_(encoder) {
    device_.copy_from(device);
    device->GetImmediateContext(context_.put());
    video_ = device_.try_as<ID3D11VideoDevice>();
    videoContext_ = context_.try_as<ID3D11VideoContext>();
  }

  // Windows Graphics Capture: a window, or a monitor Desktop Duplication
  // could not take. Windows 10 draws a yellow frame around it.
  bool Start(const wgc::GraphicsCaptureItem& item, int width, int height, int fps, bool cursor) {
    if (!SetOutput(width, height, fps)) return false;
    item_ = item;

    auto dxgi = device_.as<IDXGIDevice>();
    winrt::com_ptr<::IInspectable> inspectable;
    if (FAILED(CreateDirect3D11DeviceFromDXGIDevice(dxgi.get(), inspectable.put()))) {
      Log("CreateDirect3D11DeviceFromDXGIDevice failed");
      return false;
    }
    winrtDevice_ = inspectable.as<wgd::Direct3D11::IDirect3DDevice>();

    size_ = item.Size();
    pool_frames_ = wgc::Direct3D11CaptureFramePool::CreateFreeThreaded(
        winrtDevice_, wgd::DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, size_);
    session_ = pool_frames_.CreateCaptureSession(item);
    try {
      session_.IsCursorCaptureEnabled(cursor);
    } catch (...) {
    }
    // The yellow frame Windows draws around what is being captured. Off
    // where Windows allows it (11 and later). The access request is not
    // needed on every build and can fail on its own, so the property is set
    // whatever it answered; a refusal of either only means the frame stays.
    try {
      wgc::GraphicsCaptureAccess::RequestAccessAsync(wgc::GraphicsCaptureAccessKind::Borderless).get();
    } catch (...) {
    }
    try {
      session_.IsBorderRequired(false);
    } catch (...) {
    }

    frameArrived_ = pool_frames_.FrameArrived(winrt::auto_revoke,
                                              [this](wgc::Direct3D11CaptureFramePool const& sender,
                                                     winrt::Windows::Foundation::IInspectable const&) { OnFrame(sender); });
    closed_ = item.Closed(winrt::auto_revoke, [](wgc::GraphicsCaptureItem const&, winrt::Windows::Foundation::IInspectable const&) {
      Finish(EXIT_TARGET_GONE);
    });
    session_.StartCapture();
    repeater_ = std::thread([this] { RepeatLoop(); });
    return true;
  }

  // Desktop Duplication: a whole monitor, with no frame drawn around it on any
  // Windows, and the frame still on the GPU. False when this monitor cannot
  // be duplicated from this device (another adapter, a rotated screen), and
  // the caller falls back to Start.
  bool StartDuplication(HMONITOR monitor, int width, int height, int fps, bool cursor) {
    if (!SetOutput(width, height, fps)) return false;
    output_ = FindOutput(device_.get(), monitor, &monitorRect_);
    if (!output_) {
      Log("duplication: the monitor is not on the encoder's adapter");
      return false;
    }
    if (!CreateDuplication()) {
      Log("duplication unavailable: 0x%08lx", static_cast<unsigned long>(duplicationError_));
      return false;
    }
    // Duplication hands a rotated monitor over unrotated; Graphics Capture
    // does not, and a portrait screen is rare enough to leave to it.
    if (rotation_ != DXGI_MODE_ROTATION_IDENTITY && rotation_ != DXGI_MODE_ROTATION_UNSPECIFIED) {
      Log("duplication: rotated monitor");
      duplication_ = nullptr;
      return false;
    }
    cursorEnabled_ = cursor && cursor_.Init(device_.get());
    duplicating_ = true;
    duplicator_ = std::thread([this] { DuplicationLoop(); });
    repeater_ = std::thread([this] { RepeatLoop(); });
    return true;
  }

  // Encodes the last frame again as soon as possible, for a keyframe request
  // that arrives while nothing on screen is changing (a capture delivers no
  // frames then, and the request would wait for the next one).
  void RequestRepeat() { repeatRequested_ = true; }

  void Stop() {
    stopping_ = true;
    frameArrived_.revoke();
    closed_.revoke();
    if (repeater_.joinable()) repeater_.join();
    if (duplicator_.joinable()) duplicator_.join();
    try {
      if (session_) session_.Close();
      if (pool_frames_) pool_frames_.Close();
    } catch (...) {
    }
  }

 private:
  bool SetOutput(int width, int height, int fps) {
    if (!video_ || !videoContext_) {
      Log("the device has no video processor");
      return false;
    }
    outWidth_ = width;
    outHeight_ = height;
    fps_ = fps;
    interval_ = 10000000LL / fps;
    return true;
  }

  bool Due(LONGLONG now) const {
    // A game drawing at 144 Hz still goes out at the rate asked for. The
    // slack keeps a source that runs at exactly that rate from losing every
    // other frame to timer jitter.
    return now - lastSubmit_ >= interval_ * 8 / 10 || repeatRequested_;
  }

  bool CreateDuplication() {
    duplication_ = nullptr;
    HRESULT hr = E_FAIL;
    // DuplicateOutput1 is the one a per-monitor-DPI-aware process is meant
    // to use (Windows 10 1703 and later); DuplicateOutput is the fallback.
    if (auto output5 = output_.try_as<IDXGIOutput5>()) {
      const DXGI_FORMAT formats[] = {DXGI_FORMAT_B8G8R8A8_UNORM};
      hr = output5->DuplicateOutput1(device_.get(), 0, 1, formats, duplication_.put());
    }
    if (FAILED(hr)) {
      duplication_ = nullptr;
      hr = output_->DuplicateOutput(device_.get(), duplication_.put());
    }
    if (FAILED(hr)) {
      duplication_ = nullptr;
      duplicationError_ = hr;
      return false;
    }
    DXGI_OUTDUPL_DESC desc;
    duplication_->GetDesc(&desc);
    rotation_ = desc.Rotation;
    return true;
  }

  void DuplicationLoop() {
    DWORD task = 0;
    AvSetMmThreadCharacteristicsW(L"Capture", &task);
    DWORD lostSince = 0;
    while (!stopping_) {
      if (!duplication_) {
        // Lost: a resolution change, the UAC prompt or the lock screen, a game
        // switching to exclusive fullscreen. It comes back on its own; a
        // monitor that was unplugged does not.
        if (!CreateDuplication()) {
          if (!lostSince) lostSince = GetTickCount();
          else if (GetTickCount() - lostSince > 10000) {
            Finish(EXIT_TARGET_GONE);
            return;
          }
          Sleep(200);
          continue;
        }
        lostSince = 0;
      }
      DXGI_OUTDUPL_FRAME_INFO info = {};
      winrt::com_ptr<IDXGIResource> resource;
      const UINT timeout = static_cast<UINT>(std::max<LONGLONG>(1, interval_ / 10000));
      HRESULT hr = duplication_->AcquireNextFrame(timeout, &info, resource.put());
      if (hr == DXGI_ERROR_WAIT_TIMEOUT) continue;
      if (FAILED(hr)) {
        duplication_ = nullptr;
        continue;
      }
      const bool image = info.LastPresentTime.QuadPart != 0;
      const bool pointer = info.LastMouseUpdateTime.QuadPart != 0 && cursorEnabled_;
      if (image || pointer) {
        LONGLONG now = Now100ns();
        std::lock_guard<std::mutex> lock(gpuMutex_);
        if (image) {
          g_framesArrived++;
          auto texture = resource.try_as<ID3D11Texture2D>();
          if (texture) {
            D3D11_TEXTURE2D_DESC desc;
            texture->GetDesc(&desc);
            if (EnsureInput(desc.Width, desc.Height)) {
              context_->CopyResource(clean_.get(), texture.get());
              haveInput_ = true;
            }
          }
        }
        if (haveInput_) {
          if (Due(now)) {
            ComposeLocked();
            SubmitLocked(now);
          } else {
            pending_ = true;
          }
        }
      }
      duplication_->ReleaseFrame();
    }
  }

  // The frame to encode, from the clean desktop plus the pointer. Only
  // duplication keeps the two apart; Graphics Capture draws the pointer
  // itself.
  void ComposeLocked() {
    if (!duplicating_) return;
    context_->CopyResource(input_.get(), clean_.get());
    if (cursorEnabled_) cursor_.Draw(input_.get(), monitorRect_);
  }

  void OnFrame(wgc::Direct3D11CaptureFramePool const& sender) {
    // An exception out of here would take the capture thread, and the
    // process, down with it; one bad frame is only one frame.
    try {
      HandleFrame(sender);
    } catch (winrt::hresult_error const& error) {
      Log("frame: 0x%08lx", static_cast<unsigned long>(error.code()));
    } catch (...) {
    }
  }

  void HandleFrame(wgc::Direct3D11CaptureFramePool const& sender) {
    if (stopping_) return;
    auto frame = sender.TryGetNextFrame();
    if (!frame) return;
    g_framesArrived++;
    auto contentSize = frame.ContentSize();
    if (contentSize.Width != size_.Width || contentSize.Height != size_.Height) {
      size_ = contentSize;
      // Buffers the size of what is being captured now. This frame is still
      // the old size and is used as it is.
      sender.Recreate(winrtDevice_, wgd::DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, size_);
    }

    LONGLONG now = Now100ns();
    auto access = frame.Surface().as<::Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess>();
    winrt::com_ptr<ID3D11Texture2D> texture;
    if (FAILED(access->GetInterface(__uuidof(ID3D11Texture2D), texture.put_void()))) return;

    std::lock_guard<std::mutex> lock(gpuMutex_);
    D3D11_TEXTURE2D_DESC desc;
    texture->GetDesc(&desc);
    UINT width = std::min<UINT>(desc.Width, static_cast<UINT>(std::max(1, contentSize.Width)));
    UINT height = std::min<UINT>(desc.Height, static_cast<UINT>(std::max(1, contentSize.Height)));
    if (!EnsureInput(width, height)) return;
    D3D11_BOX box = {0, 0, 0, width, height, 1};
    context_->CopySubresourceRegion(input_.get(), 0, 0, 0, 0, texture.get(), 0, &box);
    haveInput_ = true;
    // Copied even when it is not sent yet: if the screen then goes still, the
    // newest picture is the one the repeater sends, not an older one.
    if (Due(now)) SubmitLocked(now);
    else pending_ = true;
  }

  // Keyframe requests while the screen is still, and a slow heartbeat for a
  // screen that never changes, so the stream never goes silent for long.
  void RepeatLoop() {
    while (!stopping_) {
      Sleep(50);
      LONGLONG now = Now100ns();
      LONGLONG idle = now - lastSubmit_;
      bool want = (repeatRequested_ && idle > 1000000LL) || idle > 10000000LL || (pending_ && idle >= interval_);
      if (!want) continue;
      std::lock_guard<std::mutex> lock(gpuMutex_);
      if (!haveInput_ || stopping_) continue;
      ComposeLocked();
      SubmitLocked(now);
    }
  }

  void SubmitLocked(LONGLONG now) {
    if (!processor_) return;
    int index = pool_->Acquire();
    if (index < 0) return;  // The encoder is behind; this frame is skipped.
    D3D11_VIDEO_PROCESSOR_STREAM stream = {};
    stream.Enable = TRUE;
    stream.pInputSurface = inputView_.get();
    HRESULT hr = videoContext_->VideoProcessorBlt(processor_.get(), pool_->View(index), 0, 1, &stream);
    if (FAILED(hr)) {
      pool_->Release(index);
      Log("VideoProcessorBlt: 0x%08lx", hr);
      if (hr == DXGI_ERROR_DEVICE_REMOVED || hr == DXGI_ERROR_DEVICE_RESET) Finish(EXIT_FAILED);
      return;
    }
    lastSubmit_ = now;
    repeatRequested_ = false;
    pending_ = false;
    if (startTime_ == 0) startTime_ = now;
    g_framesConverted++;
    encoder_->Submit(index, now - startTime_);
  }

  bool EnsureInput(UINT width, UINT height) {
    if (input_ && inputWidth_ == width && inputHeight_ == height) return true;
    input_ = nullptr;
    clean_ = nullptr;
    inputView_ = nullptr;
    processor_ = nullptr;
    enumerator_ = nullptr;
    haveInput_ = false;
    cursor_.Invalidate();

    D3D11_TEXTURE2D_DESC desc = {};
    desc.Width = width;
    desc.Height = height;
    desc.MipLevels = 1;
    desc.ArraySize = 1;
    desc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    desc.SampleDesc.Count = 1;
    desc.Usage = D3D11_USAGE_DEFAULT;
    desc.BindFlags = D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE;
    if (FAILED(device_->CreateTexture2D(&desc, nullptr, input_.put()))) return false;
    if (duplicating_ && FAILED(device_->CreateTexture2D(&desc, nullptr, clean_.put()))) return false;

    D3D11_VIDEO_PROCESSOR_CONTENT_DESC content = {};
    content.InputFrameFormat = D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE;
    content.InputFrameRate = {static_cast<UINT>(fps_), 1};
    content.InputWidth = width;
    content.InputHeight = height;
    content.OutputFrameRate = {static_cast<UINT>(fps_), 1};
    content.OutputWidth = outWidth_;
    content.OutputHeight = outHeight_;
    content.Usage = D3D11_VIDEO_USAGE_OPTIMAL_SPEED;
    if (FAILED(video_->CreateVideoProcessorEnumerator(&content, enumerator_.put()))) return false;
    if (FAILED(video_->CreateVideoProcessor(enumerator_.get(), 0, processor_.put()))) return false;

    D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC viewDesc = {};
    viewDesc.ViewDimension = D3D11_VPIV_DIMENSION_TEXTURE2D;
    if (FAILED(video_->CreateVideoProcessorInputView(input_.get(), enumerator_.get(), &viewDesc, inputView_.put()))) {
      return false;
    }
    // The pool's output views are tied to an enumerator; any enumerator of
    // the same device and output size will do, so they are built once.
    if (!poolReady_) {
      if (!pool_->Init(device_.get(), video_.get(), enumerator_.get(), outWidth_, outHeight_, kPoolSize)) {
        Log("could not allocate encoder textures");
        Finish(EXIT_FAILED);
        return false;
      }
      poolReady_ = true;
    }

    // Letterboxed: a window resized mid-share keeps its proportions inside
    // the stream's fixed size.
    double scale = std::min(static_cast<double>(outWidth_) / width, static_cast<double>(outHeight_) / height);
    LONG drawWidth = static_cast<LONG>(width * scale);
    LONG drawHeight = static_cast<LONG>(height * scale);
    RECT source = {0, 0, static_cast<LONG>(width), static_cast<LONG>(height)};
    RECT target = {(outWidth_ - drawWidth) / 2, (outHeight_ - drawHeight) / 2, 0, 0};
    target.right = target.left + drawWidth;
    target.bottom = target.top + drawHeight;
    RECT whole = {0, 0, outWidth_, outHeight_};
    videoContext_->VideoProcessorSetStreamFrameFormat(processor_.get(), 0, D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE);
    videoContext_->VideoProcessorSetStreamSourceRect(processor_.get(), 0, TRUE, &source);
    videoContext_->VideoProcessorSetStreamDestRect(processor_.get(), 0, TRUE, &target);
    videoContext_->VideoProcessorSetOutputTargetRect(processor_.get(), TRUE, &whole);
    videoContext_->VideoProcessorSetStreamAutoProcessingMode(processor_.get(), 0, FALSE);
    D3D11_VIDEO_COLOR black = {};
    black.RGBA.A = 1.0f;
    videoContext_->VideoProcessorSetOutputBackgroundColor(processor_.get(), FALSE, &black);
    if (auto context1 = videoContext_.try_as<ID3D11VideoContext1>()) {
      context1->VideoProcessorSetStreamColorSpace1(processor_.get(), 0, DXGI_COLOR_SPACE_RGB_FULL_G22_NONE_P709);
      context1->VideoProcessorSetOutputColorSpace1(processor_.get(), DXGI_COLOR_SPACE_YCBCR_STUDIO_G22_LEFT_P709);
    } else {
      D3D11_VIDEO_PROCESSOR_COLOR_SPACE input = {};
      input.RGB_Range = 0;
      D3D11_VIDEO_PROCESSOR_COLOR_SPACE output = {};
      output.YCbCr_Matrix = 1;
      output.Nominal_Range = D3D11_VIDEO_PROCESSOR_NOMINAL_RANGE_16_235;
      videoContext_->VideoProcessorSetStreamColorSpace(processor_.get(), 0, &input);
      videoContext_->VideoProcessorSetOutputColorSpace(processor_.get(), &output);
    }

    inputWidth_ = width;
    inputHeight_ = height;
    return true;
  }

  static const int kPoolSize = 6;

  winrt::com_ptr<ID3D11Device> device_;
  winrt::com_ptr<ID3D11DeviceContext> context_;
  winrt::com_ptr<ID3D11VideoDevice> video_;
  winrt::com_ptr<ID3D11VideoContext> videoContext_;
  TexturePool* pool_;
  Encoder* encoder_;

  wgd::Direct3D11::IDirect3DDevice winrtDevice_{nullptr};
  wgc::GraphicsCaptureItem item_{nullptr};
  wgc::Direct3D11CaptureFramePool pool_frames_{nullptr};
  wgc::GraphicsCaptureSession session_{nullptr};
  wgc::Direct3D11CaptureFramePool::FrameArrived_revoker frameArrived_;
  wgc::GraphicsCaptureItem::Closed_revoker closed_;
  winrt::Windows::Graphics::SizeInt32 size_{0, 0};

  std::mutex gpuMutex_;
  winrt::com_ptr<ID3D11Texture2D> input_;
  winrt::com_ptr<ID3D11VideoProcessorInputView> inputView_;
  winrt::com_ptr<ID3D11VideoProcessorEnumerator> enumerator_;
  winrt::com_ptr<ID3D11VideoProcessor> processor_;
  UINT inputWidth_ = 0, inputHeight_ = 0;
  bool haveInput_ = false;
  bool poolReady_ = false;

  int outWidth_ = 0, outHeight_ = 0, fps_ = 30;
  LONGLONG interval_ = 333333;
  std::atomic<LONGLONG> lastSubmit_{0};
  LONGLONG startTime_ = 0;
  std::atomic<bool> repeatRequested_{false};
  std::atomic<bool> pending_{false};
  std::atomic<bool> stopping_{false};
  std::thread repeater_;

  // Desktop Duplication
  bool duplicating_ = false;
  winrt::com_ptr<IDXGIOutput1> output_;
  winrt::com_ptr<IDXGIOutputDuplication> duplication_;
  HRESULT duplicationError_ = S_OK;
  DXGI_MODE_ROTATION rotation_ = DXGI_MODE_ROTATION_UNSPECIFIED;
  RECT monitorRect_ = {0, 0, 0, 0};
  winrt::com_ptr<ID3D11Texture2D> clean_;
  CursorOverlay cursor_;
  bool cursorEnabled_ = false;
  std::thread duplicator_;
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

struct Options {
  bool probe = false;
  HWND window = nullptr;
  bool monitor = false;
  POINT monitorPoint = {0, 0};
  int maxWidth = 1920;
  int maxHeight = 1080;
  int fps = 60;
  int bitrate = 6000;
  bool cursor = true;
  // For a monitor: Desktop Duplication first (the default), or straight to
  // Graphics Capture when the person picked it.
  bool duplication = true;
};

static bool ParseArgs(int argc, wchar_t** argv, Options& o) {
  for (int i = 1; i < argc; ++i) {
    std::wstring arg = argv[i];
    auto next = [&](long long& out) {
      if (i + 1 >= argc) return false;
      out = _wtoi64(argv[++i]);
      return true;
    };
    long long value = 0;
    if (arg == L"--probe") {
      o.probe = true;
    } else if (arg == L"--window") {
      if (!next(value) || value == 0) return false;
      o.window = reinterpret_cast<HWND>(static_cast<INT_PTR>(value));
    } else if (arg == L"--monitor") {
      long long x = 0, y = 0;
      if (!next(x) || !next(y)) return false;
      o.monitor = true;
      o.monitorPoint = {static_cast<LONG>(x), static_cast<LONG>(y)};
    } else if (arg == L"--max-width") {
      if (!next(value)) return false;
      o.maxWidth = static_cast<int>(value);
    } else if (arg == L"--max-height") {
      if (!next(value)) return false;
      o.maxHeight = static_cast<int>(value);
    } else if (arg == L"--fps") {
      if (!next(value)) return false;
      o.fps = static_cast<int>(value);
    } else if (arg == L"--bitrate") {
      if (!next(value)) return false;
      o.bitrate = static_cast<int>(value);
    } else if (arg == L"--cursor") {
      if (!next(value)) return false;
      o.cursor = value != 0;
    } else if (arg == L"--capture-method") {
      if (i + 1 >= argc) return false;
      std::wstring method = argv[++i];
      if (method == L"duplication") o.duplication = true;
      else if (method == L"wgc") o.duplication = false;
      else return false;
    } else {
      return false;
    }
  }
  if (o.probe) return true;
  if (!o.window == !o.monitor) return false;
  o.maxWidth = std::max(160, std::min(o.maxWidth, 4096));
  o.maxHeight = std::max(90, std::min(o.maxHeight, 2304));
  o.fps = std::max(1, std::min(o.fps, 240));
  o.bitrate = std::max(100, std::min(o.bitrate, 100000));
  return true;
}

static int Even(double value) {
  int n = static_cast<int>(value);
  return std::max(16, n - (n % 2));
}

// A D3D11 device on the first hardware adapter that has an H.264 encoder,
// with that encoder. The capture and the encoder must share a device for the
// frame to stay on the GPU, and on a laptop with two GPUs only one of them
// may have the encoder.
// The adapter a monitor is connected to, which is the one Desktop
// Duplication has to run on.
static bool AdapterForMonitor(HMONITOR monitor, LUID* luid) {
  winrt::com_ptr<IDXGIFactory1> factory;
  if (!monitor || FAILED(CreateDXGIFactory1(__uuidof(IDXGIFactory1), factory.put_void()))) return false;
  for (UINT i = 0;; ++i) {
    winrt::com_ptr<IDXGIAdapter1> adapter;
    if (factory->EnumAdapters1(i, adapter.put()) == DXGI_ERROR_NOT_FOUND) return false;
    for (UINT j = 0;; ++j) {
      winrt::com_ptr<IDXGIOutput> output;
      if (adapter->EnumOutputs(j, output.put()) == DXGI_ERROR_NOT_FOUND) break;
      DXGI_OUTPUT_DESC desc;
      if (FAILED(output->GetDesc(&desc)) || desc.Monitor != monitor) continue;
      DXGI_ADAPTER_DESC1 adapterDesc;
      if (FAILED(adapter->GetDesc1(&adapterDesc))) return false;
      *luid = adapterDesc.AdapterLuid;
      return true;
    }
  }
}

static bool CreateDeviceWithEncoder(winrt::com_ptr<ID3D11Device>& device, winrt::com_ptr<IMFActivate>& encoder,
                                    std::string& name, const LUID* preferred = nullptr) {
  winrt::com_ptr<IDXGIFactory1> factory;
  if (FAILED(CreateDXGIFactory1(__uuidof(IDXGIFactory1), factory.put_void()))) return false;
  // Two passes: the preferred adapter first (the monitor's), then any.
  for (int pass = preferred ? 0 : 1; pass < 2; ++pass)
  for (UINT i = 0;; ++i) {
    winrt::com_ptr<IDXGIAdapter1> adapter;
    if (factory->EnumAdapters1(i, adapter.put()) == DXGI_ERROR_NOT_FOUND) break;
    DXGI_ADAPTER_DESC1 desc;
    if (FAILED(adapter->GetDesc1(&desc)) || (desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE)) continue;
    const bool isPreferred = preferred && desc.AdapterLuid.LowPart == preferred->LowPart &&
                             desc.AdapterLuid.HighPart == preferred->HighPart;
    if ((pass == 0) != isPreferred) continue;
    auto encoders = FindHardwareEncoders(&desc.AdapterLuid);
    if (encoders.empty()) continue;

    const D3D_FEATURE_LEVEL levels[] = {D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0};
    winrt::com_ptr<ID3D11Device> candidate;
    HRESULT hr = D3D11CreateDevice(adapter.get(), D3D_DRIVER_TYPE_UNKNOWN, nullptr,
                                   D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_VIDEO_SUPPORT, levels,
                                   ARRAYSIZE(levels), D3D11_SDK_VERSION, candidate.put(), nullptr, nullptr);
    if (FAILED(hr)) continue;
    // The encoder calls into this device from its own threads.
    if (auto multithread = candidate.try_as<ID3D11Multithread>()) multithread->SetMultithreadProtected(TRUE);
    device = candidate;
    encoder = encoders.front();
    name = FriendlyName(encoder.get());
    return true;
  }
  return false;
}

static void RaisePriority(ID3D11Device* device) {
  // The whole point, as much as the GPU path: the game in front gets the
  // foreground boost, and a helper at normal priority loses every contest.
  SetPriorityClass(GetCurrentProcess(), ABOVE_NORMAL_PRIORITY_CLASS);
  // The GPU scheduler's own classes. HIGH is allowed without elevation;
  // REALTIME is not and is not asked for.
  D3DKMTSetProcessSchedulingPriorityClass(GetCurrentProcess(), D3DKMT_PRIORITY_HIGH);
  // The encoder's own work on this device, above the game's. Positive values
  // need a privilege most accounts do not hold; refused, it stays at 0.
  winrt::com_ptr<IDXGIDevice> dxgi;
  if (device && SUCCEEDED(device->QueryInterface(__uuidof(IDXGIDevice), dxgi.put_void()))) {
    dxgi->SetGPUThreadPriority(7);
  }
}

// Waits for the stop signal, and says once where frames got stuck if none have
// come out of the encoder a few seconds in. The shell passes this line on to
// the page, which is the only way to learn why a share showed nothing on a
// machine nobody here has.
static void WatchProgress() {
  const DWORD start = GetTickCount();
  bool reported = false;
  while (WaitForSingleObject(g_quit, 500) == WAIT_TIMEOUT) {
    if (reported || g_framesEncoded.load() > 0 || GetTickCount() - start < 3000) continue;
    reported = true;
    fprintf(stderr,
            "STALL arrived=%u converted=%u needInput=%u accepted=%u refused=%u lastInputError=0x%08lx\n",
            g_framesArrived.load(), g_framesConverted.load(), g_needInputEvents.load(), g_inputsAccepted.load(),
            g_inputsRefused.load(), static_cast<unsigned long>(g_lastInputError.load()));
    fflush(stderr);
  }
}

static void WatchStdin(Encoder* encoder, Capture* capture) {
  HANDLE input = GetStdHandle(STD_INPUT_HANDLE);
  std::string line;
  char buffer[256];
  for (;;) {
    DWORD read = 0;
    if (!ReadFile(input, buffer, sizeof(buffer), &read, nullptr) || read == 0) break;
    for (DWORD i = 0; i < read; ++i) {
      char c = buffer[i];
      if (c == '\r') continue;
      if (c != '\n') {
        if (line.size() < 200) line.push_back(c);
        continue;
      }
      if (line == "key") {
        encoder->ForceKey();
        capture->RequestRepeat();
      } else if (line.rfind("bitrate ", 0) == 0) {
        int kbps = atoi(line.c_str() + 8);
        if (kbps >= 100 && kbps <= 100000) encoder->SetBitrate(kbps);
      }
      line.clear();
    }
  }
  Finish(EXIT_OK);
}

int wmain(int argc, wchar_t** argv) {
  Options options;
  if (!ParseArgs(argc, argv, options)) {
    Log("usage: golive-videocap (--probe | (--window <hwnd> | --monitor <x> <y>) [--max-width n] "
        "[--max-height n] [--fps n] [--bitrate kbps] [--cursor 0|1] [--capture-method duplication|wgc])");
    return EXIT_BAD_ARGS;
  }

  _setmode(_fileno(stdout), _O_BINARY);
  g_stdout = GetStdHandle(STD_OUTPUT_HANDLE);
  // Physical pixels everywhere: the monitor point the shell sends is in them.
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

  winrt::init_apartment(winrt::apartment_type::multi_threaded);
  if (FAILED(MFStartup(MF_VERSION, MFSTARTUP_FULL))) {
    Log("MFStartup failed");
    return EXIT_UNSUPPORTED;
  }

  bool captureSupported = false;
  try {
    captureSupported = wgc::GraphicsCaptureSession::IsSupported();
  } catch (...) {
  }
  HMONITOR monitor = options.monitor ? MonitorFromPoint(options.monitorPoint, MONITOR_DEFAULTTONULL) : nullptr;
  LUID monitorAdapter = {};
  const bool haveMonitorAdapter = AdapterForMonitor(monitor, &monitorAdapter);

  winrt::com_ptr<ID3D11Device> device;
  winrt::com_ptr<IMFActivate> activate;
  std::string encoderName;
  bool haveEncoder = captureSupported && CreateDeviceWithEncoder(device, activate, encoderName,
                                                                 haveMonitorAdapter ? &monitorAdapter : nullptr);

  if (options.probe) {
    if (!haveEncoder) return EXIT_UNSUPPORTED;
    std::string line = "OK " + encoderName + "\n";
    fwrite(line.data(), 1, line.size(), stdout);
    fflush(stdout);
    return EXIT_OK;
  }
  if (!captureSupported) {
    Log("Windows Graphics Capture is not available");
    return EXIT_UNSUPPORTED;
  }
  if (!haveEncoder) {
    Log("no hardware H.264 encoder");
    return EXIT_UNSUPPORTED;
  }

  if (options.monitor && !monitor) return EXIT_TARGET_GONE;
  if (options.window && !IsWindow(options.window)) return EXIT_TARGET_GONE;

  // Graphics Capture's item, made on demand: a monitor normally goes through
  // Desktop Duplication and never needs one.
  auto makeItem = [&]() -> wgc::GraphicsCaptureItem {
    wgc::GraphicsCaptureItem item{nullptr};
    try {
      auto interop = winrt::get_activation_factory<wgc::GraphicsCaptureItem, IGraphicsCaptureItemInterop>();
      if (options.window) {
        winrt::check_hresult(interop->CreateForWindow(
            options.window, winrt::guid_of<wgc::IGraphicsCaptureItem>(), winrt::put_abi(item)));
      } else {
        winrt::check_hresult(interop->CreateForMonitor(
            monitor, winrt::guid_of<wgc::IGraphicsCaptureItem>(), winrt::put_abi(item)));
      }
    } catch (winrt::hresult_error const& error) {
      Log("could not capture the target: 0x%08lx", static_cast<unsigned long>(error.code()));
      item = nullptr;
    }
    return item;
  };

  winrt::Windows::Graphics::SizeInt32 size{0, 0};
  wgc::GraphicsCaptureItem item{nullptr};
  if (monitor) {
    MONITORINFO info = {};
    info.cbSize = sizeof(info);
    if (!GetMonitorInfoW(monitor, &info)) return EXIT_TARGET_GONE;
    size.Width = info.rcMonitor.right - info.rcMonitor.left;
    size.Height = info.rcMonitor.bottom - info.rcMonitor.top;
  } else {
    item = makeItem();
    if (!item) return EXIT_TARGET_GONE;
    size = item.Size();
  }
  double scale = std::min({1.0, static_cast<double>(options.maxWidth) / std::max(1, size.Width),
                           static_cast<double>(options.maxHeight) / std::max(1, size.Height)});
  int width = Even(size.Width * scale);
  int height = Even(size.Height * scale);

  RaisePriority(device.get());

  TexturePool pool;
  Encoder encoder(&pool);
  if (!encoder.Init(activate.get(), device.get(), width, height, options.fps, options.bitrate)) {
    return EXIT_UNSUPPORTED;
  }

  g_quit = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  std::thread encoderThread([&encoder] { encoder.Run(); });

  Capture capture(device.get(), &pool, &encoder);
  bool started = false;
  try {
    if (monitor && options.duplication) {
      started = capture.StartDuplication(monitor, width, height, options.fps, options.cursor);
    }
    if (!started) {
      if (!item) item = makeItem();
      if (item) started = capture.Start(item, width, height, options.fps, options.cursor);
    }
  } catch (winrt::hresult_error const& error) {
    Log("capture start failed: 0x%08lx", static_cast<unsigned long>(error.code()));
  }
  if (!started) {
    encoder.Stop();
    encoderThread.detach();
    ExitProcess(EXIT_FAILED);
  }

  fprintf(stderr, "READY %d %d %s\n", width, height, encoderName.c_str());
  fflush(stderr);

  std::thread stdinThread(WatchStdin, &encoder, &capture);
  stdinThread.detach();

  WatchProgress();
  capture.Stop();
  encoder.Stop();
  // The encoder's thread is parked in GetEvent, which Shutdown releases; a
  // driver that does not honour that must not hold the process open.
  if (WaitForSingleObject(static_cast<HANDLE>(encoderThread.native_handle()), 2000) == WAIT_OBJECT_0) {
    encoderThread.join();
  } else {
    encoderThread.detach();
  }
  fflush(stdout);
  // ExitProcess rather than returning: detached threads may still be inside
  // driver code, and static destruction under them is how a clean stop turns
  // into a crash dialog.
  ExitProcess(static_cast<UINT>(g_exitCode.load()));
}
