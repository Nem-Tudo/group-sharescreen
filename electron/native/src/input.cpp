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
//   golive-input (--monitor <x> <y> | --window <hwnd>) --protect-pid <pid> [--allow-app]
//   golive-input --grab-keys --protect-pid <pid>
//
//   --monitor x y     the shared monitor, named by a point inside it, in
//                     physical pixels (the same argument golive-videocap
//                     takes, worked out by the same code in the shell)
//   --window hwnd     the shared window
//   --protect-pid pid GoLive's own main process — see "What can't be touched"
//   --allow-app       GoLive's ordinary windows may be clicked and typed into
//                     too: the person at the computer ticked that in the
//                     prompt. Its always-on-top windows (the prompt itself,
//                     the "Parar" banner, a ringing call) stay out of reach.
//   --grab-keys       the other side: the computer of the person *controlling*.
//                     See "Grabbing the system shortcuts" below.
//
// stdin, one command per line (ASCII, space separated):
//   m X Y              pointer to X,Y — 0..65535 across the shared picture
//   b BTN D X Y        button BTN (0 left, 1 right, 2 middle, 3 back, 4 fwd)
//                      down (D=1) or up (D=0), at X,Y
//   w DX DY            wheel, in WHEEL_DELTA units (120 = one notch)
//   d DX DY            "modo jogo": the mouse moved by DX,DY (-4000..4000),
//                      as a real one does — what games read to aim. The
//                      pointer is kept inside the shared surface.
//   c BTN D            "modo jogo": button BTN down/up where the pointer is
//   k SC EXT D         key by scan code SC (1..127), EXT=1 for the E0
//                      prefixed ones (arrows, right Ctrl, ...), D=1 down
//   r                  release everything this program is holding down
//   g ON               --grab-keys only: start (1) or stop (0) grabbing
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
//   ZONE ok|golive|covered|elevated   what is under the pointer now, after
//                              a move — sent when it changes. The other side
//                              shows a "no entry" pointer where clicks would
//                              be dropped, instead of letting them find out.
//   CURSOR <css name>          the pointer's shape changed (default, text,
//                              pointer, ew-resize...; none when hidden). The
//                              other side draws its own pointer in that shape,
//                              so pointing feels immediate however late the
//                              picture is — the way AnyDesk does it.
//   KEY SC EXT D               --grab-keys only: a system shortcut key that
//                              was kept from Windows here, to be sent across
//   GONE                       the shared window or monitor no longer exists
//
// Exit codes: 0 stopped, 1 failure, 2 bad arguments, 4 target gone.
//
// Grabbing the system shortcuts
// -----------------------------
// The Windows key, Alt+Tab, Ctrl+Esc, Alt+F4 and PrintScreen never reach a
// web page: Windows acts on them first. For the person controlling that means
// Win+R opens *their* Run box. With --grab-keys this program runs on their
// computer instead, and while the shell says "g 1" and a GoLive window is in
// front it keeps those keys from Windows and writes them out (KEY), for the
// page to send across like any other key. Everything else is left alone and
// reaches the page the normal way. Ctrl+Alt+Del cannot be grabbed by anybody,
// and that is fine: it is the way out.
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
#include <condition_variable>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <mutex>
#include <set>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

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
  bool grabKeys = false;
  // GoLive's own windows may be clicked too — the person ticked "também o Go
  // Live" in the prompt. Its always-on-top ones never (see AlwaysOnTop).
  bool allowApp = false;
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
    } else if (arg == L"--grab-keys") {
      options.grabKeys = true;
    } else if (arg == L"--allow-app") {
      options.allowApp = true;
    } else {
      return false;
    }
  }
  if (options.protectPid == 0) return false;
  // Grabbing drives nothing, so it takes no target — and refuses one, so a
  // mixed-up command line never does half of each.
  if (options.grabKeys) return !options.monitor && options.window == nullptr;
  // Exactly one target, and the protected process is not optional: running
  // without it would make GoLive's own prompts clickable from afar.
  return options.monitor != (options.window != nullptr);
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
  // The pointer is put on the pixel itself, with SetCursorPos, rather than
  // through SendInput's absolute coordinates. Those go through a 0..65535 grid
  // over the virtual desktop whose size Windows reports differently depending
  // on DPI awareness, scaling and how the monitors are arranged — the first
  // version used them, and on real machines the pointer did not follow (it sat
  // still or stuck to an edge) while keys and the wheel, which need no
  // position, worked. SetCursorPos takes plain screen pixels, the same ones
  // TargetRect measures in, and is done by the time it returns.
  if (!SetCursorPos(point.x, point.y)) return;
  // Then a move of nothing through the real input path: programs that read
  // raw input or watch for activity see that the mouse moved, and the hover
  // under the new position updates the way it does for a hand on a mouse.
  INPUT input = {};
  input.type = INPUT_MOUSE;
  input.mi.dwFlags = MOUSEEVENTF_MOVE;
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

// The integrity level of this program's own token, once.
static DWORD IntegrityOf(HANDLE token) {
  DWORD size = 0;
  GetTokenInformation(token, TokenIntegrityLevel, nullptr, 0, &size);
  if (size == 0) return 0;
  std::vector<BYTE> buffer(size);
  if (!GetTokenInformation(token, TokenIntegrityLevel, buffer.data(), size, &size)) return 0;
  const TOKEN_MANDATORY_LABEL* label = reinterpret_cast<const TOKEN_MANDATORY_LABEL*>(buffer.data());
  const UCHAR count = *GetSidSubAuthorityCount(label->Label.Sid);
  if (count == 0) return 0;
  return *GetSidSubAuthority(label->Label.Sid, count - 1);
}

static DWORD SelfIntegrity() {
  static DWORD level = [] {
    HANDLE token = nullptr;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) return DWORD(0);
    const DWORD value = IntegrityOf(token);
    CloseHandle(token);
    return value;
  }();
  return level;
}

// Whether a process runs above this one — an elevated program, which Windows
// will not let injected input reach (UIPI). Worked out here rather than read
// from SendInput: when UIPI drops an event, SendInput still reports success.
// A process whose token cannot even be read is counted as above: from an
// ordinary program that is what an elevated one looks like. Cached for a few
// seconds — this runs on every pointer move.
static bool ProcessAbove(DWORD pid) {
  static std::unordered_map<DWORD, std::pair<bool, ULONGLONG>> cache;
  const ULONGLONG now = GetTickCount64();
  auto found = cache.find(pid);
  if (found != cache.end() && now - found->second.second < 5000) return found->second.first;
  if (cache.size() > 256) cache.clear();
  bool above = true;
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (process) {
    HANDLE token = nullptr;
    if (OpenProcessToken(process, TOKEN_QUERY, &token)) {
      const DWORD level = IntegrityOf(token);
      above = level == 0 || level > SelfIntegrity();
      CloseHandle(token);
    }
    CloseHandle(process);
  }
  cache[pid] = {above, now};
  return above;
}

// What a click at a point would reach. Callers hold g_inputLock (the cache in
// ProcessAbove is not otherwise guarded).
enum Zone { ZONE_OK = 0, ZONE_GOLIVE, ZONE_COVERED, ZONE_ELEVATED, ZONE_COUNT };
static const char* const kZoneLines[ZONE_COUNT] = {"ZONE ok", "ZONE golive", "ZONE covered", "ZONE elevated"};

// GoLive's always-on-top windows: the consent prompt, the "Parar" banner, the
// ringing call, the tray menu. Out of reach even with --allow-app — they are
// how the person at the computer says yes and stops, and nobody else may
// press them.
static bool AlwaysOnTop(HWND window) {
  HWND root = window ? GetAncestor(window, GA_ROOT) : nullptr;
  if (!root) return false;
  return (GetWindowLongPtrW(root, GWL_EXSTYLE) & WS_EX_TOPMOST) != 0;
}

static Zone ZoneOf(HWND window) {
  const DWORD pid = OwnerPid(window);
  if (pid == g_options.protectPid) {
    // GoLive itself only when the person said so in the prompt (--allow-app),
    // and even then never its always-on-top windows.
    if (!g_options.allowApp || AlwaysOnTop(window)) return ZONE_GOLIVE;
    return ZONE_OK;
  }
  // A window share's picture is that window alone, even where something else
  // is on top of it on the real desktop. A click there would land on the
  // thing on top — which the person clicking cannot see.
  if (g_options.window && pid != TargetPid()) return ZONE_COVERED;
  if (pid != 0 && pid != GetCurrentProcessId() && ProcessAbove(pid)) return ZONE_ELEVATED;
  return ZONE_OK;
}

static Zone ZoneAt(POINT point) { return ZoneOf(WindowFromPoint(point)); }

static bool Allowed(Zone zone) {
  switch (zone) {
    case ZONE_GOLIVE: Report(REPORT_GOLIVE); return false;
    case ZONE_COVERED: Report(REPORT_COVERED); return false;
    case ZONE_ELEVATED: Report(REPORT_ELEVATED); return false;
    default: return true;
  }
}

// Whether a click or a wheel turn at this point may go through.
static bool PointAllowed(POINT point) { return Allowed(ZoneAt(point)); }

// Whether keys may go to whatever has the focus right now. Typing into an
// application that is not the one being shared would be typing somewhere the
// other person cannot see.
static bool KeysAllowed() { return Allowed(ZoneOf(GetForegroundWindow())); }

// The zone under the pointer, told to the shell when it changes.
static int g_zoneShown = -1;

static void ShowZone(Zone zone) {
  if (g_zoneShown == zone) return;
  g_zoneShown = zone;
  Emit(kZoneLines[zone]);
}

static bool LocalHasPriority() { return GetTickCount64() < g_localUntil.load(); }

// ---------------------------------------------------------------------------
// The pointer's shape

struct CursorName {
  WORD id;  // the IDC_* number, spelled out: the macros change type with UNICODE
  const char* name;
};

// The system's shared cursors, by the CSS name the other side draws them
// with. Programs that use Windows' own pointers (nearly all of them, browsers
// included) hand out exactly these handles; anything else — a program's own
// artwork — is told as "default", which is what it nearly always resembles.
static const CursorName kCursors[] = {
    {32512, "default"},      // IDC_ARROW
    {32513, "text"},         // IDC_IBEAM
    {32649, "pointer"},      // IDC_HAND
    {32514, "wait"},         // IDC_WAIT
    {32650, "progress"},     // IDC_APPSTARTING
    {32515, "crosshair"},    // IDC_CROSS
    {32644, "ew-resize"},    // IDC_SIZEWE
    {32645, "ns-resize"},    // IDC_SIZENS
    {32642, "nwse-resize"},  // IDC_SIZENWSE
    {32643, "nesw-resize"},  // IDC_SIZENESW
    {32646, "move"},         // IDC_SIZEALL
    {32648, "not-allowed"},  // IDC_NO
    {32651, "help"},         // IDC_HELP
    {32516, "default"},      // IDC_UPARROW
};
static const size_t kCursorCount = sizeof(kCursors) / sizeof(kCursors[0]);

static void WatchCursor() {
  HCURSOR handles[kCursorCount] = {};
  for (size_t i = 0; i < kCursorCount; i++) handles[i] = LoadCursorW(nullptr, MAKEINTRESOURCEW(kCursors[i].id));
  const char* shown = nullptr;
  for (;;) {
    const char* name = "default";
    CURSORINFO info = {};
    info.cbSize = sizeof(info);
    if (GetCursorInfo(&info)) {
      if (!(info.flags & CURSOR_SHOWING) || !info.hCursor) {
        name = "none";
      } else {
        for (size_t i = 0; i < kCursorCount; i++) {
          if (handles[i] && info.hCursor == handles[i]) {
            name = kCursors[i].name;
            break;
          }
        }
      }
    }
    if (name != shown) {
      shown = name;
      std::string line = "CURSOR ";
      line += name;
      Emit(line.c_str());
    }
    Sleep(30);
  }
}

// ---------------------------------------------------------------------------
// Grabbing the system shortcuts (--grab-keys; see the header)

static std::atomic<bool> g_grab{false};
// Hook thread only.
static bool g_winL = false, g_winR = false, g_altL = false, g_altR = false, g_ctrlL = false, g_ctrlR = false;
static std::set<DWORD> g_swallowed;

// The hook may not wait on a pipe (see KeyboardHook), so what it grabbed goes
// through a queue that a thread of its own writes out.
static std::mutex g_keyLock;
static std::condition_variable g_keyReady;
static std::deque<std::string> g_keyQueue;

static void QueueKey(DWORD scan, bool extended, bool down) {
  char line[40];
  snprintf(line, sizeof(line), "KEY %lu %d %d", static_cast<unsigned long>(scan & 0xFF), extended ? 1 : 0,
           down ? 1 : 0);
  {
    std::lock_guard<std::mutex> lock(g_keyLock);
    if (g_keyQueue.size() >= 256) return;
    g_keyQueue.emplace_back(line);
  }
  g_keyReady.notify_one();
}

static void WriteKeys() {
  for (;;) {
    std::string line;
    {
      std::unique_lock<std::mutex> lock(g_keyLock);
      g_keyReady.wait(lock, [] { return !g_keyQueue.empty(); });
      line = std::move(g_keyQueue.front());
      g_keyQueue.pop_front();
    }
    Emit(line.c_str());
  }
}

static void GrabSet(bool on) { g_grab.store(on); }

// Whether GoLive is the window in front — the only time anything is grabbed.
// Alt+Tab on the person's own computer works as always the moment they are
// somewhere else.
static bool GoLiveInFront() { return OwnerPid(GetForegroundWindow()) == g_options.protectPid; }

static LRESULT CALLBACK GrabHook(int code, WPARAM wParam, LPARAM lParam) {
  if (code != HC_ACTION) return CallNextHookEx(nullptr, code, wParam, lParam);
  const KBDLLHOOKSTRUCT* info = reinterpret_cast<const KBDLLHOOKSTRUCT*>(lParam);
  // Injected keys are some program's, never the person's.
  if (info->flags & (LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED)) return CallNextHookEx(nullptr, code, wParam, lParam);
  const bool down = !(info->flags & LLKHF_UP);
  const DWORD vk = info->vkCode;
  switch (vk) {
    case VK_LWIN: g_winL = down; break;
    case VK_RWIN: g_winR = down; break;
    case VK_LMENU: g_altL = down; break;
    case VK_RMENU: g_altR = down; break;
    case VK_LCONTROL: g_ctrlL = down; break;
    case VK_RCONTROL: g_ctrlR = down; break;
    default: break;
  }
  bool grab = false;
  if (!down) {
    // A release is grabbed exactly when its press was, whatever changed in
    // between — half a key on each side would leave one of them held.
    grab = g_swallowed.erase(vk) > 0;
  } else if (g_grab.load() && GoLiveInFront()) {
    const bool win = g_winL || g_winR;
    const bool alt = g_altL || g_altR;
    const bool ctrl = g_ctrlL || g_ctrlR;
    grab = vk == VK_LWIN || vk == VK_RWIN || win || vk == VK_SNAPSHOT ||
           (alt && (vk == VK_TAB || vk == VK_ESCAPE || vk == VK_F4 || vk == VK_SPACE)) ||
           (ctrl && vk == VK_ESCAPE);
    if (grab) g_swallowed.insert(vk);
  }
  if (!grab) return CallNextHookEx(nullptr, code, wParam, lParam);
  QueueKey(info->scanCode, (info->flags & LLKHF_EXTENDED) != 0, down);
  return 1;
}

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
  if (g_options.grabKeys) {
    // Nothing is driven from here in this mode; the switch is all there is.
    if (command == 'g' && count == 2) GrabSet(n[0] == 1);
    return;
  }

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
      const POINT point = ToDesktop(rect, n[0], n[1]);
      MoveTo(point);
      ShowZone(ZoneAt(point));
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
    case 'd': {
      if (count != 3 || !InRange(n[0], -4000, 4000) || !InRange(n[1], -4000, 4000)) return;
      if (LocalHasPriority()) return;
      // Movement, not a place: a relative SendInput reaches raw input — which
      // is how games read the mouse — exactly like a hand on one. SetCursorPos
      // (see MoveTo) never does, which is why aiming did nothing.
      INPUT input = {};
      input.type = INPUT_MOUSE;
      input.mi.dx = static_cast<LONG>(n[0]);
      input.mi.dy = static_cast<LONG>(n[1]);
      input.mi.dwFlags = MOUSEEVENTF_MOVE;
      SendOne(input);
      // A game usually holds the pointer in place itself. When nothing does,
      // it stays on the shared surface: past its edge is somewhere the other
      // person cannot see.
      POINT cursor;
      if (GetCursorPos(&cursor)) {
        POINT inside = cursor;
        inside.x = std::min(std::max(inside.x, rect.left), rect.right - 1);
        inside.y = std::min(std::max(inside.y, rect.top), rect.bottom - 1);
        if (inside.x != cursor.x || inside.y != cursor.y) SetCursorPos(inside.x, inside.y);
        ShowZone(ZoneAt(inside));
      }
      return;
    }
    case 'c': {
      if (count != 3 || !InRange(n[0], 0, 4) || !InRange(n[1], 0, 1)) return;
      const int button = static_cast<int>(n[0]);
      if (n[1] == 0) {
        // As with 'b': a release always goes through when this program pressed.
        if (!g_buttonsDown[button]) return;
        g_buttonsDown[button] = false;
        SendButton(button, false);
        return;
      }
      if (LocalHasPriority() || g_buttonsDown[button]) return;
      POINT cursor;
      if (!GetCursorPos(&cursor) || !PointAllowed(cursor)) return;
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
    if (g_options.grabKeys) continue;
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

static int RunGrab() {
  HHOOK keyboardHook = SetWindowsHookExW(WH_KEYBOARD_LL, GrabHook, GetModuleHandleW(nullptr), 0);
  if (!keyboardHook) {
    Log("could not install the keyboard hook");
    return EXIT_FAILED;
  }
  g_lastPing.store(GetTickCount64());
  std::thread(ReadStdin).detach();
  std::thread(Watchdog).detach();
  std::thread(WriteKeys).detach();
  Emit("READY");
  MSG message;
  while (GetMessageW(&message, nullptr, 0, 0) > 0) {
    TranslateMessage(&message);
    DispatchMessageW(&message);
  }
  Finish(EXIT_OK);
}

int wmain(int argc, wchar_t** argv) {
  if (!ParseArgs(argc, argv, g_options)) {
    Log("usage: golive-input (--monitor <x> <y> | --window <hwnd>) --protect-pid <pid>");
    Log("       golive-input --grab-keys --protect-pid <pid>");
    return EXIT_BAD_ARGS;
  }
  // Physical pixels everywhere: the monitor point the shell sends is in them,
  // and so are the window and monitor rectangles and SetCursorPos for a
  // process declared this way.
  if (!SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)) {
    Log("could not declare per-monitor DPI awareness");
  }

  if (g_options.grabKeys) return RunGrab();

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
  std::thread(WatchCursor).detach();

  MSG message;
  while (GetMessageW(&message, nullptr, 0, 0) > 0) {
    TranslateMessage(&message);
    DispatchMessageW(&message);
  }
  Finish(EXIT_OK);
}
