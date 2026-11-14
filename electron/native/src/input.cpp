// golive-input — moves the mouse and presses keys for "Controle remoto".
//
// What it is for
// --------------
// Somebody sharing their screen from the GoLive app can let one person in the
// room drive their computer. That person's mouse and keyboard reach this
// machine as small messages over a WebRTC data channel, the page hands them to
// the shell (electron/remoteControl.ts), and the shell writes them here, one
// line each. This program is the only part of GoLive that turns them into
// real input, with SendInput.
//
// It is its own executable, not a mode of golive-videocap, for the same
// reasons as the other helpers (see the header of audiocap.cpp) plus one: a
// program that injects input is exactly what antivirus heuristics look hard
// at. Kept apart, a quarantine here costs remote control and nothing else —
// the share itself keeps working.
//
// Usage
// -----
//   golive-input (--monitor <x> <y> | --window <hwnd>) --protect-pid <pid>
//
//   --monitor x y     the shared monitor, named by a point inside it, in
//                     physical pixels (the same argument golive-videocap
//                     takes, worked out by the same code in the shell)
//   --window hwnd     the shared window
//   --protect-pid pid GoLive's own main process — see "What can't be touched"
//
// stdin, one command per line (ASCII, space separated):
//   m X Y              pointer to X,Y — 0..65535 across the shared picture
//   b BTN D X Y        button BTN (0 left, 1 right, 2 middle, 3 back, 4 fwd)
//                      down (D=1) or up (D=0), at X,Y
//   w DX DY            wheel, in WHEEL_DELTA units (120 = one notch)
//   k SC EXT D         key by scan code SC (1..127), EXT=1 for the E0
//                      prefixed ones (arrows, right Ctrl, ...), D=1 down
//   r                  release everything this program is holding down
//   p                  ping — the shell sends one a second
//   q                  quit
//
// stdout, one event per line:
//   READY                      hooks are in, commands are being taken
//   LOCAL                      the person at this computer moved the mouse or
//                              typed (throttled to one a second)
//   HOTKEY                     the person at this computer pressed
//                              Ctrl+Alt+Esc; the program exits right after
//   BLOCKED golive|covered|elevated   a click or key was dropped, and why
//                              (throttled per reason)
//   GONE                       the shared window or monitor no longer exists
//
// Exit codes: 0 stopped, 1 failure, 2 bad arguments, 4 target gone.
//
// Safety, in the order it matters
// -------------------------------
// 1. Nothing stays pressed. Every key and button this program pressed is
//    released when it exits for any reason it can see coming: stdin closing
//    (the shell died), "q", three seconds without a ping (the shell hung), the
//    hotkey, the target going away. A remote session that ended with Ctrl held
//    down would be a computer that does strange things for no visible reason.
//
// 2. The person at the computer always wins. Low-level hooks watch the real
//    mouse and keyboard — events Windows marks LL*_INJECTED are ours (or some
//    other program's) and are ignored. Real input pauses the remote one for a
//    moment, so the two never fight over the pointer.
//
// 3. The stop key can't be faked. Ctrl+Alt+Esc counts only when all three
//    come from the real keyboard, which the injected flag tells apart. The
//    remote side can send the same keys all it likes; this program ignores
//    them as a hotkey.
//
// 4. What can't be touched: GoLive itself. A click, a wheel turn or a key
//    whose target is a window of the GoLive app (its main process, given as
//    --protect-pid; Chromium's top-level windows all belong to it) is
//    dropped. That covers the room, the "Permitir" prompt, the "Parar" banner
//    and the settings — the person being helped can always see and use them,
//    and the person helping can never press them blind.
//
// 5. Windows' own line. Elevated windows and the UAC prompt are out of reach
//    (UIPI: this runs asInvoker, without uiAccess), and Ctrl+Alt+Del cannot be
//    injected at all. Both are on purpose.

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <dwmapi.h>

#include <algorithm>
#include <atomic>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <set>
#include <string>
#include <thread>

static const int EXIT_OK = 0;
static const int EXIT_FAILED = 1;
static const int EXIT_BAD_ARGS = 2;
static const int EXIT_TARGET_GONE = 4;

// How long real input keeps the remote one paused.
static const ULONGLONG LOCAL_PRIORITY_MS = 750;
// How long the shell may go quiet before this program assumes it is gone.
static const ULONGLONG PING_TIMEOUT_MS = 3000;
// One report per this, per kind, at most.
static const ULONGLONG REPORT_THROTTLE_MS = 1000;

// ---------------------------------------------------------------------------
// Options

struct Options {
  bool monitor = false;
  POINT monitorPoint = {0, 0};
  HWND window = nullptr;
  DWORD protectPid = 0;
};

static bool ParseLong(const wchar_t* text, long long& out) {
  if (!text || !*text) return false;
  wchar_t* end = nullptr;
  out = wcstoll(text, &end, 10);
  return end && *end == L'\0';
}

static bool ParseArgs(int argc, wchar_t** argv, Options& options) {
  for (int i = 1; i < argc; i++) {
    std::wstring arg = argv[i];
    long long a = 0, b = 0;
    if (arg == L"--monitor" && i + 2 < argc) {
      if (!ParseLong(argv[i + 1], a) || !ParseLong(argv[i + 2], b)) return false;
      options.monitor = true;
      options.monitorPoint = {static_cast<LONG>(a), static_cast<LONG>(b)};
      i += 2;
    } else if (arg == L"--window" && i + 1 < argc) {
      if (!ParseLong(argv[i + 1], a) || a <= 0) return false;
      options.window = reinterpret_cast<HWND>(static_cast<intptr_t>(a));
      i += 1;
    } else if (arg == L"--protect-pid" && i + 1 < argc) {
      if (!ParseLong(argv[i + 1], a) || a <= 0) return false;
      options.protectPid = static_cast<DWORD>(a);
      i += 1;
    } else {
      return false;
    }
  }
  // Exactly one target, and the protected process is not optional: running
  // without it would make GoLive's own prompts clickable from afar.
  return (options.monitor != (options.window != nullptr)) && options.protectPid != 0;
}

static Options g_options;

// ---------------------------------------------------------------------------
// Output

static std::mutex g_outLock;

static void Emit(const char* line) {
  std::lock_guard<std::mutex> lock(g_outLock);
  fputs(line, stdout);
  fputc('\n', stdout);
  fflush(stdout);
}

static void Log(const char* text) {
  fputs(text, stderr);
  fputc('\n', stderr);
  fflush(stderr);
}

// Throttled reports, one slot per kind.
enum ReportKind { REPORT_LOCAL, REPORT_GOLIVE, REPORT_COVERED, REPORT_ELEVATED, REPORT_COUNT };
static const char* const kReportLines[REPORT_COUNT] = {"LOCAL", "BLOCKED golive", "BLOCKED covered",
                                                       "BLOCKED elevated"};
static std::atomic<ULONGLONG> g_lastReport[REPORT_COUNT];

static void Report(ReportKind kind) {
  ULONGLONG now = GetTickCount64();
  ULONGLONG last = g_lastReport[kind].load();
  if (last != 0 && now - last < REPORT_THROTTLE_MS) return;
  if (!g_lastReport[kind].compare_exchange_strong(last, now)) return;
  Emit(kReportLines[kind]);
}

// ---------------------------------------------------------------------------
// What is held down

// Guards SendInput and everything below: the stdin thread injects, the
// watchdog and the hotkey release, and the two must never interleave a press
// with the release-everything that follows it.
static std::mutex g_inputLock;
// Scan codes held down, with bit 8 set for the extended ones.
static std::set<int> g_keysDown;
static bool g_buttonsDown[5] = {false, false, false, false, false};

static const DWORD kButtonDown[5] = {MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_MIDDLEDOWN,
                                     MOUSEEVENTF_XDOWN, MOUSEEVENTF_XDOWN};
static const DWORD kButtonUp[5] = {MOUSEEVENTF_LEFTUP, MOUSEEVENTF_RIGHTUP, MOUSEEVENTF_MIDDLEUP,
                                   MOUSEEVENTF_XUP, MOUSEEVENTF_XUP};
static const DWORD kButtonData[5] = {0, 0, 0, XBUTTON1, XBUTTON2};

static bool SendOne(INPUT& input) {
  if (SendInput(1, &input, sizeof(INPUT)) == 1) return true;
  // UIPI refuses input aimed at a window with higher integrity (an elevated
  // program); that is the line we promised not to cross, so it is only
  // reported, never worked around.
  if (GetLastError() == ERROR_ACCESS_DENIED) Report(REPORT_ELEVATED);
  return false;
}

static void SendKey(int code, bool down) {
  INPUT input = {};
  input.type = INPUT_KEYBOARD;
  input.ki.wScan = static_cast<WORD>(code & 0xFF);
  input.ki.dwFlags = KEYEVENTF_SCANCODE | ((code & 0x100) ? KEYEVENTF_EXTENDEDKEY : 0) | (down ? 0 : KEYEVENTF_KEYUP);
  SendOne(input);
}

static void SendButton(int button, bool down) {
  INPUT input = {};
  input.type = INPUT_MOUSE;
  input.mi.dwFlags = down ? kButtonDown[button] : kButtonUp[button];
  input.mi.mouseData = kButtonData[button];
  SendOne(input);
}

// Caller holds g_inputLock.
static void ReleaseAllLocked() {
  for (int code : g_keysDown) SendKey(code, false);
  g_keysDown.clear();
  for (int button = 0; button < 5; button++) {
    if (!g_buttonsDown[button]) continue;
    g_buttonsDown[button] = false;
    SendButton(button, false);
  }
}

[[noreturn]] static void Finish(int code) {
  {
    std::lock_guard<std::mutex> lock(g_inputLock);
    ReleaseAllLocked();
  }
  fflush(stdout);
  ExitProcess(static_cast<UINT>(code));
}

// ---------------------------------------------------------------------------
// The real mouse and keyboard

static std::atomic<ULONGLONG> g_localUntil{0};
static std::atomic<bool> g_hotkey{false};
// Reported by the watchdog, not the hook: see NoteLocalInput.
static std::atomic<bool> g_localPending{false};
// Physical modifier state, kept from the hook itself: GetAsyncKeyState would
// count injected presses too, and the whole point is that those don't.
static bool g_physCtrlL = false, g_physCtrlR = false, g_physAltL = false, g_physAltR = false;

static void NoteLocalInput() {
  g_localUntil.store(GetTickCount64() + LOCAL_PRIORITY_MS);
  g_localPending.store(true);
}

// Both hooks must return fast — Windows silently removes a low-level hook
// that takes longer than LowLevelHooksTimeout — so they only set flags. Even
// the "LOCAL" line is written by the watchdog: a write to a pipe the shell has
// not drained yet can block, and a hook that blocks is a hook that is gone.
static LRESULT CALLBACK MouseHook(int code, WPARAM wParam, LPARAM lParam) {
  if (code == HC_ACTION) {
    const MSLLHOOKSTRUCT* info = reinterpret_cast<const MSLLHOOKSTRUCT*>(lParam);
    if (!(info->flags & (LLMHF_INJECTED | LLMHF_LOWER_IL_INJECTED))) NoteLocalInput();
  }
  return CallNextHookEx(nullptr, code, wParam, lParam);
}

static LRESULT CALLBACK KeyboardHook(int code, WPARAM wParam, LPARAM lParam) {
  if (code == HC_ACTION) {
    const KBDLLHOOKSTRUCT* info = reinterpret_cast<const KBDLLHOOKSTRUCT*>(lParam);
    if (!(info->flags & (LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED))) {
      const bool down = !(info->flags & LLKHF_UP);
      switch (info->vkCode) {
        case VK_LCONTROL: g_physCtrlL = down; break;
        case VK_RCONTROL: g_physCtrlR = down; break;
        case VK_LMENU: g_physAltL = down; break;
        case VK_RMENU: g_physAltR = down; break;
        default: break;
      }
      if (down && info->vkCode == VK_ESCAPE && (g_physCtrlL || g_physCtrlR) && (g_physAltL || g_physAltR)) {
        g_hotkey.store(true);
        // Swallowed: the combination means nothing to Windows, and passing
        // the Esc on would close whatever dialog happens to be in front.
        return 1;
      }
      NoteLocalInput();
    }
  }
  return CallNextHookEx(nullptr, code, wParam, lParam);
}

// ---------------------------------------------------------------------------
// Where things are

// The shared picture's rectangle on the desktop, in physical pixels.
static bool TargetRect(RECT& rect) {
  if (g_options.window) {
    if (!IsWindow(g_options.window)) return false;
    // The extended frame bounds, not GetWindowRect: the latter includes the
    // invisible resize borders Windows 10 puts around every window, and
    // Graphics Capture's picture — what the person on the other side sees and
    // points at — does not.
    if (SUCCEEDED(DwmGetWindowAttribute(g_options.window, DWMWA_EXTENDED_FRAME_BOUNDS, &rect, sizeof(rect)))) {
      return rect.right > rect.left && rect.bottom > rect.top;
    }
    return GetWindowRect(g_options.window, &rect) != FALSE;
  }
  HMONITOR monitor = MonitorFromPoint(g_options.monitorPoint, MONITOR_DEFAULTTONULL);
  if (!monitor) return false;
  MONITORINFO info = {};
  info.cbSize = sizeof(info);
  if (!GetMonitorInfoW(monitor, &info)) return false;
  rect = info.rcMonitor;
  return true;
}

static POINT ToDesktop(const RECT& rect, int x, int y) {
  const LONG width = rect.right - rect.left;
  const LONG height = rect.bottom - rect.top;
  POINT point;
  point.x = rect.left + static_cast<LONG>((static_cast<long long>(x) * (width - 1) + 32767) / 65535);
  point.y = rect.top + static_cast<LONG>((static_cast<long long>(y) * (height - 1) + 32767) / 65535);
  return point;
}

static void MoveTo(POINT point) {
  // Absolute coordinates over the whole virtual desktop are 0..65535 from its
  // top-left to its bottom-right pixel. In a per-monitor DPI aware process the
  // virtual screen metrics are physical pixels, the same as everything else
  // here.
  const int left = GetSystemMetrics(SM_XVIRTUALSCREEN);
  const int top = GetSystemMetrics(SM_YVIRTUALSCREEN);
  const int width = std::max(2, GetSystemMetrics(SM_CXVIRTUALSCREEN));
  const int height = std::max(2, GetSystemMetrics(SM_CYVIRTUALSCREEN));
  INPUT input = {};
  input.type = INPUT_MOUSE;
  input.mi.dx = static_cast<LONG>((static_cast<long long>(point.x - left) * 65535 + (width - 1) / 2) / (width - 1));
  input.mi.dy = static_cast<LONG>((static_cast<long long>(point.y - top) * 65535 + (height - 1) / 2) / (height - 1));
  input.mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK;
  SendOne(input);
}

static DWORD OwnerPid(HWND window) {
  if (!window) return 0;
  HWND root = GetAncestor(window, GA_ROOT);
  DWORD pid = 0;
  GetWindowThreadProcessId(root ? root : window, &pid);
  return pid;
}

// The process behind the shared window. Compared by process rather than by
// window because an application's menus, dropdowns and dialogs are windows of
// their own — clicking a menu item of the shared program is still clicking the
// shared program.
static DWORD TargetPid() { return g_options.window ? OwnerPid(g_options.window) : 0; }

// Whether a click or a wheel turn at this point may go through.
static bool PointAllowed(POINT point) {
  HWND under = WindowFromPoint(point);
  if (OwnerPid(under) == g_options.protectPid) {
    Report(REPORT_GOLIVE);
    return false;
  }
  if (g_options.window) {
    // A window share's picture is that window alone, even where something
    // else is on top of it on the real desktop. A click there would land on
    // the thing on top — which the person clicking cannot see.
    if (OwnerPid(under) != TargetPid()) {
      Report(REPORT_COVERED);
      return false;
    }
  }
  return true;
}

// Whether keys may go to whatever has the focus right now.
static bool KeysAllowed() {
  HWND focused = GetForegroundWindow();
  if (OwnerPid(focused) == g_options.protectPid) {
    Report(REPORT_GOLIVE);
    return false;
  }
  if (g_options.window && OwnerPid(focused) != TargetPid()) {
    // Typing into an application that is not the one being shared would be
    // typing somewhere the other person cannot see.
    Report(REPORT_COVERED);
    return false;
  }
  return true;
}

static bool LocalHasPriority() { return GetTickCount64() < g_localUntil.load(); }

// ---------------------------------------------------------------------------
// Commands

static std::atomic<ULONGLONG> g_lastPing{0};

static bool InRange(long value, long low, long high) { return value >= low && value <= high; }

static void HandleLine(char* line) {
  char* tokens[6] = {};
  int count = 0;
  char* context = nullptr;
  for (char* token = strtok_s(line, " \t\r", &context); token && count < 6;
       token = strtok_s(nullptr, " \t\r", &context)) {
    tokens[count++] = token;
  }
  if (count == 0) return;
  long n[5] = {};
  for (int i = 1; i < count; i++) n[i - 1] = strtol(tokens[i], nullptr, 10);
  const char command = tokens[0][0];
  if (tokens[0][1] != '\0') return;

  if (command == 'p') {
    g_lastPing.store(GetTickCount64());
    return;
  }
  if (command == 'q') Finish(EXIT_OK);

  std::lock_guard<std::mutex> lock(g_inputLock);
  if (command == 'r') {
    ReleaseAllLocked();
    return;
  }

  RECT rect;
  if (!TargetRect(rect)) {
    Emit("GONE");
    ReleaseAllLocked();
    fflush(stdout);
    ExitProcess(EXIT_TARGET_GONE);
  }

  switch (command) {
    case 'm': {
      if (count != 3 || !InRange(n[0], 0, 65535) || !InRange(n[1], 0, 65535)) return;
      if (LocalHasPriority()) return;
      MoveTo(ToDesktop(rect, n[0], n[1]));
      return;
    }
    case 'b': {
      if (count != 5 || !InRange(n[0], 0, 4) || !InRange(n[1], 0, 1) || !InRange(n[2], 0, 65535) ||
          !InRange(n[3], 0, 65535)) {
        return;
      }
      const int button = static_cast<int>(n[0]);
      const bool down = n[1] == 1;
      if (!down) {
        // A release always goes through — wherever the pointer is and whoever
        // has priority — when this program did the press. Otherwise a drag
        // that ended over GoLive would leave the button held.
        if (!g_buttonsDown[button]) return;
        g_buttonsDown[button] = false;
        SendButton(button, false);
        return;
      }
      if (LocalHasPriority() || g_buttonsDown[button]) return;
      const POINT point = ToDesktop(rect, n[2], n[3]);
      if (!PointAllowed(point)) return;
      MoveTo(point);
      g_buttonsDown[button] = true;
      SendButton(button, true);
      return;
    }
    case 'w': {
      if (count != 3 || !InRange(n[0], -1200, 1200) || !InRange(n[1], -1200, 1200)) return;
      if (LocalHasPriority()) return;
      POINT cursor;
      if (!GetCursorPos(&cursor) || !PointAllowed(cursor)) return;
      if (n[1] != 0) {
        INPUT input = {};
        input.type = INPUT_MOUSE;
        input.mi.dwFlags = MOUSEEVENTF_WHEEL;
        // Browsers report "down" as positive, Windows as negative.
        input.mi.mouseData = static_cast<DWORD>(-n[1]);
        SendOne(input);
      }
      if (n[0] != 0) {
        INPUT input = {};
        input.type = INPUT_MOUSE;
        input.mi.dwFlags = MOUSEEVENTF_HWHEEL;
        input.mi.mouseData = static_cast<DWORD>(n[0]);
        SendOne(input);
      }
      return;
    }
    case 'k': {
      if (count != 4 || !InRange(n[0], 1, 127) || !InRange(n[1], 0, 1) || !InRange(n[2], 0, 1)) return;
      const int code = static_cast<int>(n[0]) | (n[1] ? 0x100 : 0);
      const bool down = n[2] == 1;
      if (!down) {
        if (g_keysDown.erase(code) == 0) return;
        SendKey(code, false);
        return;
      }
      if (LocalHasPriority() || !KeysAllowed()) return;
      // Auto-repeat comes from the other side as repeated downs, as on a real
      // keyboard; only the first one is remembered as held.
      g_keysDown.insert(code);
      SendKey(code, true);
      return;
    }
    default:
      return;
  }
}

static void ReadStdin() {
  HANDLE input = GetStdHandle(STD_INPUT_HANDLE);
  std::string pending;
  char buffer[4096];
  for (;;) {
    DWORD read = 0;
    if (!ReadFile(input, buffer, sizeof(buffer), &read, nullptr) || read == 0) break;
    pending.append(buffer, read);
    size_t start = 0;
    for (;;) {
      size_t end = pending.find('\n', start);
      if (end == std::string::npos) break;
      std::string line = pending.substr(start, end - start);
      start = end + 1;
      // Commands are a few dozen bytes; anything long is not one of ours.
      if (line.size() < 64) HandleLine(&line[0]);
    }
    pending.erase(0, start);
    if (pending.size() > 4096) pending.clear();
  }
  // The shell is gone, or closed the pipe to stop this.
  Finish(EXIT_OK);
}

// The hotkey, the ping deadline and the target's existence — everything that
// ends the session without a command saying so.
static void Watchdog() {
  ULONGLONG lastTargetCheck = 0;
  for (;;) {
    Sleep(50);
    if (g_hotkey.load()) {
      Emit("HOTKEY");
      Finish(EXIT_OK);
    }
    if (g_localPending.exchange(false)) Report(REPORT_LOCAL);
    const ULONGLONG now = GetTickCount64();
    if (now - g_lastPing.load() > PING_TIMEOUT_MS) {
      Log("no ping from the shell; stopping");
      Finish(EXIT_OK);
    }
    if (now - lastTargetCheck >= 1000) {
      lastTargetCheck = now;
      RECT rect;
      if (!TargetRect(rect)) {
        Emit("GONE");
        Finish(EXIT_TARGET_GONE);
      }
    }
  }
}

int wmain(int argc, wchar_t** argv) {
  if (!ParseArgs(argc, argv, g_options)) {
    Log("usage: golive-input (--monitor <x> <y> | --window <hwnd>) --protect-pid <pid>");
    return EXIT_BAD_ARGS;
  }
  // Physical pixels everywhere: the monitor point the shell sends is in them,
  // and so are SendInput's absolute coordinates for a process declared this way.
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

  RECT rect;
  if (!TargetRect(rect)) {
    Emit("GONE");
    return EXIT_TARGET_GONE;
  }

  // Low-level hooks run on the thread that installed them, and only while that
  // thread pumps messages — so this one does nothing else.
  HINSTANCE module = GetModuleHandleW(nullptr);
  HHOOK mouseHook = SetWindowsHookExW(WH_MOUSE_LL, MouseHook, module, 0);
  HHOOK keyboardHook = SetWindowsHookExW(WH_KEYBOARD_LL, KeyboardHook, module, 0);
  if (!mouseHook || !keyboardHook) {
    // Without them neither the local priority nor the stop key would work,
    // and those are not optional.
    Log("could not install the input hooks");
    return EXIT_FAILED;
  }

  g_lastPing.store(GetTickCount64());
  std::thread(ReadStdin).detach();
  std::thread(Watchdog).detach();
  Emit("READY");

  MSG message;
  while (GetMessageW(&message, nullptr, 0, 0) > 0) {
    TranslateMessage(&message);
    DispatchMessageW(&message);
  }
  Finish(EXIT_OK);
}
