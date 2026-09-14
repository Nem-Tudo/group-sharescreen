// golive-audiocap — system audio capture that leaves GoLive out of it.
//
// Why this is a separate executable and not a Node addon
// ------------------------------------------------------
// Everything here could have been an N-API module loaded into the Electron
// main process. It is a standalone .exe instead, for three reasons that all
// bite later rather than now:
//
//   1. A native addon is bound to a Node/Electron ABI. Every Electron bump
//      would need a rebuild and a matching prebuild for every arch, and a
//      mismatch is a hard crash at require() time — in an app that
//      auto-updates its own shell. A plain Win32 executable has no ABI to
//      match: it keeps working across Electron versions untouched.
//   2. Real-time audio capture runs its own thread at MMCSS "Pro Audio"
//      priority and blocks on an event. Doing that inside the process that
//      also runs Chromium is asking for the two to interfere.
//   3. If this crashes — a driver going away mid-capture is a real thing —
//      it takes down a 200 KB helper, not the call the user is in.
//
// What it does
// ------------
// Captures system audio through the WASAPI process-loopback activation path
// (AUDIOCLIENT_ACTIVATION_PARAMS) and writes the result to stdout as raw PCM,
// in one of two shapes:
//
//   --exclude-pid <pid>   everything the machine is playing *except* that
//                         process tree (PROCESS_LOOPBACK_MODE_EXCLUDE_*)
//   --include-pid <pid>   only that process tree (..._INCLUDE_*)
//
// plus two modes that capture nothing at all and only report:
//
//   --list-sessions       the processes that currently hold an audio stream
//   --list-windows        the applications a person would say are open
//
// EXCLUDE is the mode this program was written for. INCLUDE and the listings
// exist because the exclusion cannot be widened: the activation parameters
// carry exactly one TargetProcessId, so "everything except GoLive *and*
// Discord" — which is what the picker's per-app mute list asks for — has to
// be assembled from the other direction. The shell lists the sessions, runs
// one INCLUDE capture per application the user did not mute, and mixes them
// (see electron/systemAudio.ts).
//
// The two listings answer deliberately different questions. --list-windows is
// what the picker shows, because a person mutes "Discord", an application
// they have open, and has no idea which processes hold an audio stream.
// --list-sessions is what the capture acts on, because a stream is the only
// thing there is to leave out. They meet at the executable name.
//
// That exclusion is the entire point. GoLive plays every remote
// participant's voice and every remote screen share through its own audio
// output; an ordinary loopback capture picks those up and sends them
// straight back to the room, so everyone hears themselves a beat late. The
// target process id passed on the command line is Electron's main process,
// and "process tree" covers its children — which is where Chromium actually
// renders audio, since the audio service is a child utility process rather
// than part of the renderer.
//
// Derived from Microsoft's ApplicationLoopback sample:
// https://learn.microsoft.com/en-us/samples/microsoft/windows-classic-samples/applicationloopbackaudio-sample/
//
// Which Windows versions this works on
// ------------------------------------
// Not decided here, and deliberately not decided from a build number
// anywhere else either. Microsoft documents process loopback as needing
// build 20348 — a number that reads as "Windows 11 only", since consumer
// Windows 10 stops at 19045 — but that is Server 2022's build, and the
// sample is reported working on Windows 10 22H2 all the same. What actually
// fails on Windows 10 is GetMixFormat/IsFormatSupported, which return
// E_NOTIMPL (see microsoft/Windows-classic-samples#343).
//
// This program never calls either of them: process loopback is not tied to
// an endpoint, so the format is stated rather than negotiated, and the one
// documented Windows 10 failure is therefore not on our path.
//
// So support is answered by *trying it*. On success this prints READY (see
// kReadyLine) and starts streaming; when activation is refused it exits with
// EXIT_UNSUPPORTED, and the shell falls back to Electron's own loopback
// capture. A version check would only have been a guess at that answer, and
// on this API a wrong guess disables the feature for machines that can run
// it perfectly well.

#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
// Session enumeration, for --list-sessions. IAudioSessionManager2 is the only
// way to ask "which processes currently hold an audio stream", and that list
// is what the picker's per-app mute list is built from.
#include <audiopolicy.h>
#include <avrt.h>
#include <mmreg.h>
#include <objbase.h>
// GetFileVersionInfo/VerQueryValue, for an executable's FileDescription --
// "Discord" rather than "Discord.exe". windows.h drags winver.h in already
// unless WIN32_LEAN_AND_MEAN is defined; named here so this keeps compiling
// if that ever changes.
#include <winver.h>
// DwmGetWindowAttribute, for --list-windows: the only way to tell a suspended
// Store application's window apart from one somebody actually has open.
#include <dwmapi.h>

#include <fcntl.h>
#include <io.h>
#include <stdio.h>
// Named rather than left to windows.h to drag in: _wtoi64 is stdlib's,
// wcscmp/fwprintf/fputws are wchar's. Both do arrive transitively today, and
// relying on that is how a build breaks on an SDK update that tidied its own
// includes — in CI, where the round trip to find out is minutes long.
#include <stdlib.h>
#include <wchar.h>

#include <algorithm>
#include <atomic>
#include <condition_variable>
#include <deque>
#include <mutex>
#include <new>
#include <string>
#include <thread>
#include <vector>

// Exit codes the shell distinguishes. Anything else is an unexpected
// failure and is treated like a crash.
static const int EXIT_OK = 0;
static const int EXIT_BAD_ARGS = 2;
// The OS does not have process loopback, or refused the activation.
// Recoverable: the caller uses Electron's own loopback instead.
static const int EXIT_UNSUPPORTED = 3;

// Printed on stderr once the capture is actually running. This is the
// shell's "it works here" signal, and the reason no version check is needed
// on either side: activation either succeeds and this appears, or it fails
// and the process exits. Sent on stderr rather than stdout to keep the PCM
// stream on stdout free of anything that is not audio.
static const wchar_t* kReadyLine = L"READY\n";

// The one format this tool speaks. Fixed rather than negotiated because the
// consumer is a Web Audio graph that wants 48 kHz stereo anyway, and process
// loopback lets us *ask* for a format instead of accepting an endpoint's mix
// format — the capture is not tied to a device at all. 16-bit rather than
// float32 halves what crosses two IPC hops per chunk, and the conversion on
// the other side is one multiply.
static const WORD kChannels = 2;
static const DWORD kSampleRate = 48000;
static const WORD kBitsPerSample = 16;

// How much audio may pile up between the capture thread and the thread that
// writes to stdout. The reader is Electron's main process, which is
// occasionally busy; without a queue a hiccup there would stall the capture
// thread and show up as a glitch in the stream. Half a second is far more
// than a healthy reader ever needs, so reaching this limit means the reader
// is gone or wedged — at which point the *oldest* audio is what to drop,
// since this is a live stream and stale samples have no value.
static const size_t kMaxQueuedBytes =
    (kSampleRate * kChannels * (kBitsPerSample / 8)) / 2;

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

// ActivateAudioInterfaceAsync answers through a COM callback rather than
// returning the interface, so this object exists only to be signalled.
//
// Heap-allocated and properly reference counted, rather than a local of the
// function that waits on it. The tempting version — put it on the stack,
// have Release() do nothing, return once the event is signalled — has a
// narrow use-after-free in it: ActivateCompleted signals the event and only
// *then* returns, at which point the API still holds its own reference and
// will Release it. The waiting thread can wake, return, and unwind that
// stack frame in between, leaving the API to call Release on memory that no
// longer exists. Letting the refcount decide when this dies costs one
// allocation and closes the window.
class ActivationHandler : public IActivateAudioInterfaceCompletionHandler,
                          public IAgileObject {
 public:
  ActivationHandler() : done_(CreateEventW(nullptr, TRUE, FALSE, nullptr)) {}

  ~ActivationHandler() {
    if (client_) client_->Release();
    if (done_) CloseHandle(done_);
  }

  // Blocks until ActivateCompleted has run. INFINITE is safe here: the API
  // contract is that the handler is always invoked, success or failure.
  HRESULT Wait(IAudioClient** out) {
    if (!done_) return E_FAIL;
    WaitForSingleObject(done_, INFINITE);
    if (FAILED(result_)) return result_;
    *out = client_;
    client_ = nullptr;  // ownership moves to the caller
    return S_OK;
  }

  HANDLE event() const { return done_; }

  STDMETHODIMP ActivateCompleted(
      IActivateAudioInterfaceAsyncOperation* operation) override {
    HRESULT activate_hr = S_OK;
    IUnknown* unknown = nullptr;
    HRESULT hr = operation->GetActivateResult(&activate_hr, &unknown);
    // Two results to check, not one: the call can succeed while the
    // activation it reports failed. Collapsing them loses exactly the error
    // we care about on an unsupported Windows build.
    if (SUCCEEDED(hr)) hr = activate_hr;
    if (SUCCEEDED(hr) && unknown) {
      hr = unknown->QueryInterface(__uuidof(IAudioClient),
                                   reinterpret_cast<void**>(&client_));
    }
    if (unknown) unknown->Release();
    result_ = hr;
    SetEvent(done_);
    return S_OK;
  }

  STDMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
    if (!ppv) return E_POINTER;
    if (riid == __uuidof(IUnknown) ||
        riid == __uuidof(IActivateAudioInterfaceCompletionHandler)) {
      *ppv = static_cast<IActivateAudioInterfaceCompletionHandler*>(this);
    } else if (riid == __uuidof(IAgileObject)) {
      *ppv = static_cast<IAgileObject*>(this);
    } else {
      *ppv = nullptr;
      return E_NOINTERFACE;
    }
    AddRef();
    return S_OK;
  }

  STDMETHODIMP_(ULONG) AddRef() override { return ++refs_; }
  STDMETHODIMP_(ULONG) Release() override {
    const ULONG remaining = --refs_;
    if (remaining == 0) delete this;
    return remaining;
  }

 private:
  HANDLE done_ = nullptr;
  IAudioClient* client_ = nullptr;
  HRESULT result_ = E_UNEXPECTED;
  std::atomic<ULONG> refs_{1};
};

static HRESULT ActivateProcessLoopback(DWORD pid, bool include,
                                      IAudioClient** out) {
  AUDIOCLIENT_ACTIVATION_PARAMS params = {};
  params.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  params.ProcessLoopbackParams.TargetProcessId = pid;
  // EXCLUDE is the mode this program was written for: everything the machine
  // is playing *except* GoLive, which is what a screen share carrying system
  // audio should contain.
  //
  // INCLUDE captures one process tree and nothing else. It is here for a
  // limitation of the API rather than for its own sake:
  // AUDIOCLIENT_ACTIVATION_PARAMS carries a single TargetProcessId, so
  // "everything except GoLive *and* Discord" cannot be asked for at all. The
  // shell builds that set instead by running one INCLUDE capture per
  // application it does want and mixing them (see electron/systemAudio.ts) --
  // which is why the setting the user sees is a list of apps to leave out,
  // while what crosses this boundary is one pid to take in.
  params.ProcessLoopbackParams.ProcessLoopbackMode =
      include ? PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE
              : PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;

  PROPVARIANT activate_params = {};
  activate_params.vt = VT_BLOB;
  activate_params.blob.cbSize = static_cast<ULONG>(sizeof(params));
  activate_params.blob.pBlobData = reinterpret_cast<BYTE*>(&params);

  ActivationHandler* handler = new (std::nothrow) ActivationHandler();
  if (!handler) return E_OUTOFMEMORY;
  if (!handler->event()) {
    handler->Release();
    return E_FAIL;
  }

  IActivateAudioInterfaceAsyncOperation* operation = nullptr;
  HRESULT hr = ActivateAudioInterfaceAsync(
      VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, __uuidof(IAudioClient),
      &activate_params, handler, &operation);
  if (operation) operation->Release();
  if (SUCCEEDED(hr)) hr = handler->Wait(out);
  // Drops *our* reference only. Any reference the API is still holding keeps
  // the object alive until it is done with it, which is the whole point.
  handler->Release();
  return hr;
}

// ---------------------------------------------------------------------------
// Session listing
// ---------------------------------------------------------------------------
//
// --list-sessions answers one question: which applications currently have an
// audio stream open on the default output device. That is the list the
// picker's "do not share sound from these apps" panel is built from, and it
// is also how the shell knows which process trees to run INCLUDE captures
// against once something in it is muted.
//
// Audio sessions rather than "every running process", on purpose. A process
// with no audio session cannot make a sound, so listing it would offer the
// user a switch that does nothing; conversely an application holds its
// session for as long as it keeps an audio client open, not only while it
// happens to be playing something, so this is not a list that flickers.

// stdout is in binary mode (see wmain), so the encoding is stated here rather
// than left to the CRT: UTF-8, which is what Node reads on the other end. An
// application name is whatever the vendor put in its version resource, and
// that includes scripts the console codepage cannot represent.
static void WriteUtf8(const wchar_t* text) {
  const int bytes =
      WideCharToMultiByte(CP_UTF8, 0, text, -1, nullptr, 0, nullptr, nullptr);
  if (bytes <= 1) return;  // empty, or unconvertible
  std::vector<char> buffer(static_cast<size_t>(bytes));
  WideCharToMultiByte(CP_UTF8, 0, text, -1, buffer.data(), bytes, nullptr,
                      nullptr);
  // -1 drops the terminating NUL: this is a stream, not a C string.
  fwrite(buffer.data(), 1, static_cast<size_t>(bytes) - 1, stdout);
}

// The output is one tab-separated record per line, so a name carrying a tab
// or a newline would silently produce a second, malformed record. A vendor's
// version resource is not a trusted source of well-formed text.
static void SanitizeField(std::wstring* value) {
  for (size_t i = 0; i < value->size(); i++) {
    if ((*value)[i] < L' ') (*value)[i] = L' ';
  }
}

static bool ProcessPath(DWORD pid, std::wstring* out) {
  // LIMITED_INFORMATION rather than QUERY_INFORMATION: it is the right the
  // API documents for exactly this call, and it is obtainable for processes
  // running at a higher integrity level, where the wider right is refused.
  // Without that distinction every elevated application would be missing from
  // the list with nothing to say why.
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!process) return false;
  wchar_t buffer[MAX_PATH * 4];
  DWORD length = static_cast<DWORD>(sizeof(buffer) / sizeof(buffer[0]));
  const bool ok = QueryFullProcessImageNameW(process, 0, buffer, &length) != 0;
  CloseHandle(process);
  if (!ok) return false;
  out->assign(buffer, length);
  return true;
}

// "Discord", "Google Chrome", "Spotify" — the name a person knows the program
// by, which lives in its version resource and nowhere else. Optional: plenty
// of executables ship without one, and the caller falls back to the file name.
static bool FileDescription(const wchar_t* path, std::wstring* out) {
  DWORD ignored = 0;
  const DWORD size = GetFileVersionInfoSizeW(path, &ignored);
  if (size == 0) return false;
  std::vector<BYTE> block(size);
  if (!GetFileVersionInfoW(path, 0, size, block.data())) return false;

  struct LangCodePage {
    WORD language;
    WORD code_page;
  };
  LangCodePage* translations = nullptr;
  UINT bytes = 0;
  if (!VerQueryValueW(block.data(), L"\\VarFileInfo\\Translation",
                      reinterpret_cast<void**>(&translations), &bytes) ||
      !translations || bytes < sizeof(LangCodePage)) {
    return false;
  }
  // A resource may carry several translations, and there is no way from here
  // to know which one a given machine would prefer. The first that actually
  // has a description is a better answer than none.
  const size_t count = bytes / sizeof(LangCodePage);
  for (size_t i = 0; i < count; i++) {
    wchar_t key[64];
    swprintf(key, 64, L"\\StringFileInfo\\%04x%04x\\FileDescription",
             translations[i].language, translations[i].code_page);
    wchar_t* value = nullptr;
    UINT length = 0;
    if (VerQueryValueW(block.data(), key, reinterpret_cast<void**>(&value),
                       &length) &&
        value && length > 0 && value[0] != L'\0') {
      // length counts characters *including* the terminator, and a malformed
      // resource may not have one — so the bound is honoured rather than
      // trusted.
      out->assign(value, wcsnlen(value, length));
      return true;
    }
  }
  return false;
}

// One record of a listing: "<pid>\t<name>\t<full path>", UTF-8, newline
// terminated. Shared by both listings so the caller has one format to parse.
static void PrintProcessRow(DWORD pid) {
  std::wstring path;
  // A process that ended between the enumeration and this call, or one this
  // token cannot open at all. Both are ordinary; skip it.
  if (!ProcessPath(pid, &path)) return;
  std::wstring name;
  if (!FileDescription(path.c_str(), &name) || name.empty()) {
    const size_t slash = path.find_last_of(L'\\');
    name = slash == std::wstring::npos ? path : path.substr(slash + 1);
  }
  SanitizeField(&name);
  SanitizeField(&path);

  wchar_t prefix[32];
  swprintf(prefix, 32, L"%lu\t", pid);
  WriteUtf8(prefix);
  WriteUtf8(name.c_str());
  WriteUtf8(L"\t");
  WriteUtf8(path.c_str());
  WriteUtf8(L"\n");
}

// The processes holding a session on one output device, appended to `pids`
// (each once — the same process routinely has a session on several devices).
static void CollectDeviceSessions(IMMDevice* device, std::vector<DWORD>* pids) {
  IAudioSessionManager2* manager = nullptr;
  HRESULT hr = device->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL,
                                nullptr, reinterpret_cast<void**>(&manager));
  if (FAILED(hr)) return;

  IAudioSessionEnumerator* sessions = nullptr;
  hr = manager->GetSessionEnumerator(&sessions);
  manager->Release();
  if (FAILED(hr)) return;

  int count = 0;
  if (FAILED(sessions->GetCount(&count))) count = 0;
  for (int i = 0; i < count; i++) {
    IAudioSessionControl* control = nullptr;
    if (FAILED(sessions->GetSession(i, &control)) || !control) continue;
    IAudioSessionControl2* control2 = nullptr;
    hr = control->QueryInterface(__uuidof(IAudioSessionControl2),
                                 reinterpret_cast<void**>(&control2));
    control->Release();
    if (FAILED(hr) || !control2) continue;

    DWORD pid = 0;
    // The system-sounds session has no process behind it: nothing to name in
    // a list of applications, and nothing to run a capture against.
    const bool usable = control2->IsSystemSoundsSession() != S_OK &&
                        SUCCEEDED(control2->GetProcessId(&pid)) && pid != 0;
    control2->Release();
    if (!usable) continue;
    bool seen = false;
    for (DWORD known : *pids) seen = seen || known == pid;
    if (!seen) pids->push_back(pid);
  }
  sessions->Release();
}

// Every process holding a render session, on *every* active output device.
// Exits EXIT_UNSUPPORTED when there is no output device to enumerate at all,
// which the shell treats the way it treats an empty list.
//
// Every device, not only the default one, which is what this used to read.
// Process loopback captures a process wherever it plays, but the shell only
// learns a process exists from this list — so an application sending its
// sound to a device other than the default (Discord set to a headset while
// Windows' default is the speakers, a game on a second output) was never on
// it. Muting it then did nothing: the capture never saw a muted application
// running, stayed in "everything except GoLive" and recorded it anyway; and
// in per-application mode, an unmuted one on another device was never
// included, and went silent instead.
static int ListRenderSessions() {
  IMMDeviceEnumerator* enumerator = nullptr;
  HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr,
                                CLSCTX_ALL, __uuidof(IMMDeviceEnumerator),
                                reinterpret_cast<void**>(&enumerator));
  if (FAILED(hr)) return EXIT_UNSUPPORTED;

  IMMDeviceCollection* devices = nullptr;
  hr = enumerator->EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, &devices);
  enumerator->Release();
  if (FAILED(hr)) {
    fwprintf(stderr, L"cannot enumerate render endpoints: 0x%08lX\n", hr);
    return EXIT_UNSUPPORTED;
  }

  UINT device_count = 0;
  if (FAILED(devices->GetCount(&device_count))) device_count = 0;
  if (device_count == 0) {
    devices->Release();
    fwprintf(stderr, L"no active render endpoint\n");
    return EXIT_UNSUPPORTED;
  }

  std::vector<DWORD> pids;
  for (UINT i = 0; i < device_count; i++) {
    IMMDevice* device = nullptr;
    if (FAILED(devices->Item(i, &device)) || !device) continue;
    CollectDeviceSessions(device, &pids);
    device->Release();
  }
  devices->Release();

  for (DWORD pid : pids) PrintProcessRow(pid);
  fflush(stdout);
  return EXIT_OK;
}

// ---------------------------------------------------------------------------
// Window listing
// ---------------------------------------------------------------------------
//
// --list-windows answers "which applications are open", the way a person
// means it: the things that would show up if they pressed alt-tab. That is
// the list the picker offers for muting, and it is deliberately not the same
// question as --list-sessions above — a person picks Discord out of a list of
// programs they have open, not out of a list of audio streams they cannot
// see. The two meet at the executable name.

// The filter that turns "every HWND on the desktop" into "every application
// someone would say is open". Each of these removes a specific kind of
// non-window that would otherwise be listed as a program.
static bool IsAppWindow(HWND window) {
  if (!IsWindowVisible(window)) return false;
  // An owned window is a dialog, a palette or a tooltip belonging to an
  // application that is already in the list on its own account.
  if (GetWindow(window, GW_OWNER) != nullptr) return false;
  // No title is the signature of the invisible message-only and helper
  // windows that most frameworks create; there would be nothing to name.
  if (GetWindowTextLengthW(window) == 0) return false;
  if (GetWindowLongPtrW(window, GWL_EXSTYLE) & WS_EX_TOOLWINDOW) return false;
  // Store applications leave a real, visible, titled window behind when they
  // are suspended — the shell hides it by "cloaking" rather than by making it
  // invisible, so without this check a machine lists half a dozen programs
  // nobody has opened. This is the same attribute the alt-tab switcher reads.
  BOOL cloaked = FALSE;
  if (SUCCEEDED(DwmGetWindowAttribute(window, DWMWA_CLOAKED, &cloaked,
                                      sizeof(cloaked))) &&
      cloaked) {
    return false;
  }
  return true;
}

static BOOL CALLBACK CollectWindow(HWND window, LPARAM param) {
  if (IsAppWindow(window)) {
    DWORD pid = 0;
    GetWindowThreadProcessId(window, &pid);
    if (pid != 0) reinterpret_cast<std::vector<DWORD>*>(param)->push_back(pid);
  }
  return TRUE;  // keep enumerating
}

static int ListOpenWindows() {
  std::vector<DWORD> pids;
  EnumWindows(CollectWindow, reinterpret_cast<LPARAM>(&pids));
  // One application is routinely several windows, and the caller groups by
  // executable anyway — but de-duplicating the pids here keeps the output
  // proportional to the number of programs rather than to the number of
  // windows they happen to have open.
  std::vector<DWORD> seen;
  for (size_t i = 0; i < pids.size(); i++) {
    if (std::find(seen.begin(), seen.end(), pids[i]) != seen.end()) continue;
    seen.push_back(pids[i]);
    PrintProcessRow(pids[i]);
  }
  fflush(stdout);
  return EXIT_OK;
}

// ---------------------------------------------------------------------------
// stdout writer
// ---------------------------------------------------------------------------

// Decouples the capture thread from the pipe. See kMaxQueuedBytes.
class PcmSink {
 public:
  void Push(const BYTE* data, size_t bytes) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (closed_) return;
    queued_bytes_ += bytes;
    chunks_.emplace_back(data, data + bytes);
    while (queued_bytes_ > kMaxQueuedBytes && !chunks_.empty()) {
      queued_bytes_ -= chunks_.front().size();
      chunks_.pop_front();
    }
    ready_.notify_one();
  }

  void Close() {
    {
      std::lock_guard<std::mutex> lock(mutex_);
      closed_ = true;
    }
    ready_.notify_all();
  }

  // Returns when the sink is closed and drained, or when writing to stdout
  // fails — which is how this process learns the shell is gone. A broken
  // pipe is a normal end of life here, not an error worth reporting.
  void Run() {
    for (;;) {
      std::vector<BYTE> chunk;
      {
        std::unique_lock<std::mutex> lock(mutex_);
        ready_.wait(lock, [&] { return closed_ || !chunks_.empty(); });
        if (chunks_.empty()) return;  // closed and drained
        chunk.swap(chunks_.front());
        chunks_.pop_front();
        queued_bytes_ -= chunk.size();
      }
      if (fwrite(chunk.data(), 1, chunk.size(), stdout) != chunk.size()) return;
      fflush(stdout);
    }
  }

 private:
  std::mutex mutex_;
  std::condition_variable ready_;
  std::deque<std::vector<BYTE>> chunks_;
  size_t queued_bytes_ = 0;
  bool closed_ = false;
};

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

struct CaptureContext {
  IAudioCaptureClient* capture = nullptr;
  HANDLE buffer_ready = nullptr;
  HANDLE quit = nullptr;
  PcmSink* sink = nullptr;
  WORD block_align = static_cast<WORD>(kChannels * (kBitsPerSample / 8));
};

static void CaptureLoop(CaptureContext* ctx) {
  // Without this the capture thread is scheduled like any other and drops
  // packets under load — which is audible as clicks in the shared audio.
  DWORD task_index = 0;
  HANDLE mm_task = AvSetMmThreadCharacteristicsW(L"Pro Audio", &task_index);

  HANDLE waits[2] = {ctx->quit, ctx->buffer_ready};
  bool running = true;
  // Reused across packets so the steady state allocates nothing.
  std::vector<BYTE> silence;

  while (running) {
    DWORD wait = WaitForMultipleObjects(2, waits, FALSE, INFINITE);
    if (wait != WAIT_OBJECT_0 + 1) break;  // quit signalled, or the wait failed

    for (;;) {
      BYTE* data = nullptr;
      UINT32 frames = 0;
      DWORD flags = 0;
      HRESULT hr =
          ctx->capture->GetBuffer(&data, &frames, &flags, nullptr, nullptr);
      if (hr == AUDCLNT_S_BUFFER_EMPTY) break;
      if (FAILED(hr)) {
        // AUDCLNT_E_DEVICE_INVALIDATED lands here when the default endpoint
        // changes or a device is unplugged. Ending the process is the right
        // response: the shell restarts it, which re-activates against
        // whatever the system is using now.
        running = false;
        break;
      }

      const size_t bytes = static_cast<size_t>(frames) * ctx->block_align;
      if (bytes > 0) {
        if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
          // The pointer is not meaningful when this flag is set, so the
          // silence has to be synthesized rather than copied. Sending it at
          // all, instead of skipping the packet, keeps the reader's jitter
          // buffer at a steady fill through quiet stretches.
          if (silence.size() < bytes) silence.assign(bytes, 0);
          ctx->sink->Push(silence.data(), bytes);
        } else {
          ctx->sink->Push(data, bytes);
        }
      }
      ctx->capture->ReleaseBuffer(frames);
    }
  }

  if (mm_task) AvRevertMmThreadCharacteristics(mm_task);
  ctx->sink->Close();
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

// The shell closing our stdin is the shutdown signal. It is more reliable
// than waiting to be killed: a TerminateProcess leaves WASAPI to clean up
// after the fact, while this stops the client properly. It also covers the
// case where the shell dies without getting to kill anything.
static void WatchStdin(HANDLE quit) {
  HANDLE in = GetStdHandle(STD_INPUT_HANDLE);
  char scratch[64];
  DWORD read = 0;
  while (in != INVALID_HANDLE_VALUE &&
         ReadFile(in, scratch, sizeof(scratch), &read, nullptr) && read > 0) {
    // Nothing is ever sent on stdin; only the EOF matters.
  }
  SetEvent(quit);
}

int wmain(int argc, wchar_t** argv) {
  DWORD target_pid = 0;
  bool include = false;
  bool list_sessions = false;
  bool list_windows = false;
  for (int i = 1; i < argc; i++) {
    if (wcscmp(argv[i], L"--list-sessions") == 0) {
      list_sessions = true;
    } else if (wcscmp(argv[i], L"--list-windows") == 0) {
      list_windows = true;
    } else if (wcscmp(argv[i], L"--exclude-pid") == 0 && i + 1 < argc) {
      target_pid = static_cast<DWORD>(_wtoi64(argv[++i]));
      include = false;
    } else if (wcscmp(argv[i], L"--include-pid") == 0 && i + 1 < argc) {
      target_pid = static_cast<DWORD>(_wtoi64(argv[++i]));
      include = true;
    }
  }

  // Raw PCM down a pipe: without this the CRT would helpfully turn every
  // 0x0A byte in the audio into 0x0D 0x0A and corrupt the stream. Set for
  // --list-sessions too, which writes its own UTF-8 rather than letting the
  // CRT pick an encoding and a line ending for it.
  _setmode(_fileno(stdout), _O_BINARY);

  // No COM: EnumWindows and the version resources are plain Win32.
  if (list_windows) return ListOpenWindows();

  if (list_sessions) {
    HRESULT com = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (FAILED(com)) return EXIT_UNSUPPORTED;
    const int code = ListRenderSessions();
    CoUninitialize();
    return code;
  }

  if (target_pid == 0) {
    fwprintf(stderr,
             L"usage: golive-audiocap --exclude-pid <pid>\n"
             L"       golive-audiocap --include-pid <pid>\n"
             L"       golive-audiocap --list-sessions\n"
             L"       golive-audiocap --list-windows\n");
    return EXIT_BAD_ARGS;
  }

  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(hr)) return EXIT_UNSUPPORTED;

  IAudioClient* client = nullptr;
  hr = ActivateProcessLoopback(target_pid, include, &client);
  if (FAILED(hr)) {
    // The expected failure on Windows 10, where this activation type does
    // not exist. Reported on stderr so the shell's log says why rather than
    // only showing an exit code.
    fwprintf(stderr, L"process loopback activation failed: 0x%08lX\n", hr);
    CoUninitialize();
    return EXIT_UNSUPPORTED;
  }

  WAVEFORMATEX format = {};
  format.wFormatTag = WAVE_FORMAT_PCM;
  format.nChannels = kChannels;
  format.nSamplesPerSec = kSampleRate;
  format.wBitsPerSample = kBitsPerSample;
  format.nBlockAlign =
      static_cast<WORD>(format.nChannels * format.wBitsPerSample / 8);
  format.nAvgBytesPerSec = format.nSamplesPerSec * format.nBlockAlign;
  format.cbSize = 0;

  // AUTOCONVERTPCM lets the audio engine resample whatever the excluded mix
  // actually is into the format above, which is why this can state a fixed
  // 48 kHz stereo rather than negotiating one. SRC_DEFAULT_QUALITY is the
  // documented companion flag; without it the conversion is the cheap one.
  hr = client->Initialize(
      AUDCLNT_SHAREMODE_SHARED,
      AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK |
          AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM |
          AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
      // 200 ms of engine buffer, in 100 ns units. Generous on purpose: the
      // reader is a Node process, and underrunning here costs audio, while
      // the latency this adds is bounded by how fast we drain it rather than
      // by the buffer size.
      2000000, 0, &format, nullptr);
  if (FAILED(hr)) {
    fwprintf(stderr, L"IAudioClient::Initialize failed: 0x%08lX\n", hr);
    client->Release();
    CoUninitialize();
    return EXIT_UNSUPPORTED;
  }

  IAudioCaptureClient* capture = nullptr;
  hr = client->GetService(__uuidof(IAudioCaptureClient),
                          reinterpret_cast<void**>(&capture));
  if (FAILED(hr)) {
    client->Release();
    CoUninitialize();
    return EXIT_UNSUPPORTED;
  }

  HANDLE buffer_ready = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  HANDLE quit = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  client->SetEventHandle(buffer_ready);

  PcmSink sink;
  CaptureContext ctx;
  ctx.capture = capture;
  ctx.buffer_ready = buffer_ready;
  ctx.quit = quit;
  ctx.sink = &sink;

  hr = client->Start();
  if (FAILED(hr)) {
    fwprintf(stderr, L"IAudioClient::Start failed: 0x%08lX\n", hr);
    capture->Release();
    client->Release();
    CoUninitialize();
    return EXIT_UNSUPPORTED;
  }

  // Everything that could have refused has now succeeded, so the caller can
  // stop waiting and commit to this path. Flushed explicitly because stderr
  // is a pipe here, not a console, and the caller is blocked on this line.
  fputws(kReadyLine, stderr);
  fflush(stderr);

  std::thread stdin_watch(WatchStdin, quit);
  stdin_watch.detach();
  std::thread capture_thread(CaptureLoop, &ctx);

  // Runs until the capture thread closes the sink, or until stdout breaks —
  // whichever comes first. Both mean the same thing: stop.
  sink.Run();
  SetEvent(quit);
  capture_thread.join();

  client->Stop();
  capture->Release();
  client->Release();
  CloseHandle(buffer_ready);
  CloseHandle(quit);
  CoUninitialize();
  return EXIT_OK;
}
