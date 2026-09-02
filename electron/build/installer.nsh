; Windows-only half of the uninstall count (see the API's appInstallStore.ts).
;
; electron-builder inserts this file's macros into the installer it generates
; — see electron-builder.yml's `nsis.include`. The only one defined here is
; customUnInstall, which runs while the uninstaller is tearing the app down.
;
; This exists because Windows is the one platform that lets an installer run
; anything on the way out. A .dmg is uninstalled by dragging the app to the
; trash, an AppImage by deleting a file, and Android never delivers a removal
; broadcast to the app being removed — none of those give anyone a chance to
; say goodbye, which is why the number this feeds is desktop-only and always
; will be.

; The endpoint the report goes to. A literal rather than something read from
; the environment: NSIS resolves this at compile time, and a build whose
; installer quietly pointed at nothing would look identical to one that
; worked. A dev build simply reports to production and is rejected there —
; its install id was never seen by that server (see recordAppUninstall).
!ifndef GOLIVE_UNINSTALL_ENDPOINT
  !define GOLIVE_UNINSTALL_ENDPOINT "https://apigolive.nemtudo.me/app/uninstall"
!endif

!macro customUnInstall
  ; $0-$3 belong to whoever is running this macro, not to us: electron-builder
  ; inserts it in the middle of its own uninstall section, and NSIS registers
  ; are global. Saved and restored on *every* path out — which is why the exits
  ; below jump to a label that sits above these pops instead of returning.
  Push $0
  Push $1
  Push $2
  Push $3

  ; An update is an uninstall too. electron-updater applies a new version by
  ; running this very uninstaller and then installing over the top, so
  ; reporting unconditionally would turn every auto-update into a fake
  ; uninstall — the loudest possible way to be wrong about a number nobody
  ; can sanity-check by eye.
  ;
  ; IfSilent is what separates the two, and it is a core NSIS instruction
  ; rather than something the electron-builder scripts hand us: the updater
  ; runs the uninstaller with /S, while a person removing the app from
  ; Settings or the Control Panel gets the visible one. The cost is that a
  ; genuine `Uninstall.exe /S` from a management tool goes unreported, which
  ; is the safe direction to be wrong in — this number is a floor either way
  ; (a deleted folder or an offline machine leaves no trace at all), and a
  ; missing report is a smaller lie than an invented one.
  ;
  ; Even so, the server treats a report as provisional rather than final: an
  ; install that registers again clears it (see recordAppInstall). So if this
  ; check is ever wrong on some Windows build, the app coming back the way it
  ; does after an update repairs the count on its own.
  IfSilent uninstall_report_done

  ClearErrors
  ; Written by the app itself — see electron/main.ts's writeInstallIdFile,
  ; whose comment explains why this path is a constant both sides agree on
  ; instead of Electron's userData directory. Missing file means an install
  ; that never ran a version new enough to leave one; nothing to report, and
  ; nothing to complain about.
  FileOpen $0 "$APPDATA\GoLive\install-id" r
  IfErrors uninstall_report_done
  FileRead $0 $1
  FileClose $0
  StrCmp $1 "" uninstall_report_done

  ; PowerShell rather than a plugin: it is on every supported Windows, and
  ; needs nothing bundled into the installer. nsExec runs it without a
  ; console window, the whole thing is wrapped in try/catch so a failure is
  ; silent, and the 5-second timeout is there because the person is standing
  ; in front of a progress bar waiting for this to finish — an uninstall must
  ; never hang on a statistic.
  ;
  ; The id travels in the query string on purpose. A JSON body would have to
  ; survive NSIS quoting, PowerShell quoting and JSON quoting at once, and
  ; the id is 16-64 characters of hex and hyphens — nothing that needs
  ; escaping in a URL.
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-RestMethod -Method Post -TimeoutSec 5 -Uri '${GOLIVE_UNINSTALL_ENDPOINT}?installId=$1' } catch { }"'
  Pop $2
  Pop $3

  ; Only on a real uninstall. An update leaves it in place — not that it
  ; would matter much, since the app rewrites it on the next launch, but
  ; deleting state on the way to reinstalling the same program is the kind of
  ; thing that is fine until the day it isn't.
  Delete "$APPDATA\GoLive\install-id"
  ; No /r: this removes the directory only if it is empty, so anything else
  ; that ever lands in there survives.
  RMDir "$APPDATA\GoLive"

  uninstall_report_done:
  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend
