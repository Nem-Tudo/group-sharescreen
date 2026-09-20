# GoLive desktop (Electron)

A **shell around the deployed site**, not a second copy of it. The window
loads `https://golive.nemtudo.me` and the entire UI — every component, all
the WebRTC, the whole mesh/cascade implementation — comes from there
unchanged.

That is deliberate. Bundling the Next build inside the app would buy nothing:
this is a real-time communication app, so it is useless without a network
connection anyway, and the site has server-side API routes (`/api/giphy`,
`/api/umami`) that a static export cannot serve. One deploy, one thing to keep
working, and a shipped app that never falls behind the website.

## What the shell actually adds

Five things, and everything in `main.ts` exists for one of them:

1. **A screen picker.** Electron does not implement `getDisplayMedia`'s own
   chooser. Without `setDisplayMediaRequestHandler` the app's single most
   important feature simply fails. The OS picker is preferred where it exists
   (`useSystemPicker`); `picker.html` is the fallback everywhere else. It is
   also where the share's sound is decided: a "Compartilhar som da tela"
   switch, and behind its gear the applications currently open, any of which
   can be ticked to keep its sound out of the stream. Nothing starts out
   ticked except GoLive itself, which is always muted and cannot be
   un-muted — see `audioSettings.ts`.
2. **A working OAuth flow.** Providers refuse to authenticate inside an
   embedded browser — Google rejects it outright as `disallowed_useragent` —
   so login leaves for the real browser and comes back through a custom
   protocol. See below.
3. **System audio without the echo.** A screen share carrying system audio
   captures GoLive too — every participant's voice, and the audio of any
   share being watched — and sends it back to the room, so everyone hears
   themselves a beat late. `native/golive-audiocap.exe` captures the mix with
   our own process tree excluded instead. Windows only; see below.
4. **Being reachable with the window closed.** Closing the window hides it to
   the tray instead of quitting, and the app starts with the system. That
   sounds like a preference and is not: it is the desktop's *entire* answer to
   "uma ligação tem que tocar mesmo com o app fechado", because Electron has no
   push service — there is no message anybody can send to a desktop
   application that is not running. What there can be is an application that
   is still running, quietly, with its socket open, which is what every other
   desktop chat app does and for the same reason. See `background.ts`.
5. **The security posture remote content requires.** No Node in the renderer,
   no navigating away from our own origin, no in-app windows for third-party
   links.

## Segundo plano, bandeja e chamadas

Two settings, both visible and reversible from the tray menu, both defaulting
to on:

| Setting | Sem ela |
| --- | --- |
| **Manter em segundo plano ao fechar** | O app acaba no momento em que alguém aperta o X, e nenhuma outra coisa traz um toque até ele |
| **Abrir com o sistema** | A anterior só ajuda até o próximo boot |

Autostart é ligado **na primeira execução e nunca mais** (`applyFirstRunDefaults`).
Um padrão que se reaplica a cada abertura desfaz em silêncio a decisão de quem
o desligou, e aí não é mais um padrão — é recusar-se a aceitar um não.

Um app que se mantém vivo depois que a janela sumiu e que se inicia sozinho
precisa ser *encontrável*, senão é algo que a pessoa não vê, não alcança e não
consegue desligar — o que descreve malware, não um app de conversa. Por isso o
ícone na bandeja existe enquanto o app existir, e as duas chaves estão no menu
dele.

Quando alguém liga, o site manda `IPC.callRinging` e o shell faz a única coisa
que só ele pode fazer: tira a janela da bandeja e pisca a entrada na barra de
tarefas. Deliberadamente **não** rouba o foco — isso um telefone tocando pode
fazer, um aplicativo não. Quem está sendo perguntado é quem decide olhar.

O renderer não é estrangulado enquanto escondido (`backgroundThrottling: false`
em `webPreferences`, que já estava lá pelos atalhos globais), e é isso que
mantém o socket e os handlers vivos em vez de limitados a um timer por segundo.

## Apertar para falar, e a tecla que ninguém vê soltar

`globalShortcut` responde uma única pergunta — "esta tecla foi apertada" — e o
push to talk precisa da outra: quando ela foi **solta**. Não existe key-up, e
não existe perguntar se a tecla está pressionada agora.

O que existe é o sistema operacional repetindo o atalho enquanto a tecla fica
presa. Então a descida é o primeiro disparo, e a subida é inferida das
repetições pararem. Isso cobra um rabinho — o microfone continua aberto por uma
fração de segundo depois que a tecla sobe — e esse rabinho **tem que ser maior
que o intervalo até a primeira repetição** (o atraso de teclado do Windows,
tipicamente 500ms), senão toda frase começaria cortada. Depois que as
repetições estão chegando o intervalo entre elas é curto, e a espera cai junto.

O site estreita isso sozinho: com o GoLive em foco ele tem keyup de verdade e
usa esse (`lib/pushToTalk.ts`). O caminho daqui é para o que só o shell pode
fazer — a tecla segurada dentro de um jogo, com a janela em lugar nenhum.

Duas armadilhas, as duas já resolvidas em `main.ts`:

- `updateGlobalShortcuts` começa com `unregisterAll()`, que levava junto a
  tecla do push to talk. Ela é registrada de novo no fim — o site define as
  duas coisas em canais separados e uma não pode apagar a outra em silêncio.
- Uma página que recarregou com a tecla presa registra a mesma tecla de novo
  já com ela solta. Por isso o handler de `pushToTalkSet` solta antes de
  registrar: sem isso o shell seguiria achando que está presa e nunca mandaria
  a descida que reabre o microfone.

## The OAuth handoff

The interesting part, because it spans three processes that cannot see each
other fail.

```
app: startOAuth(url, nonce)          returnTo = <origin>/desktop/oauth/<nonce>
  └─> shell.openExternal ──> system browser ──> provider ──> API
                                                             │
        API keeps only returnTo's *pathname* ────────────────┘
                                                             ▼
                       browser lands on <origin>/oauth/callback#…&next=/desktop/oauth/<nonce>
                                                             │
        callback page sees the marker path, no opener ───────┘
                                                             ▼
                              golive://oauth#<same fragment>  ──> app
                                                             │
        main matches the nonce against a login in flight ────┘
                                                             ▼
                              renderer's promise resolves with the fragment
```

Two details carry the design:

- **The marker lives in the path** because the API validates `returnTo`
  against an origin allowlist and keeps only the pathname, dropping query and
  hash. The path is the one part that survives the round trip — so this
  needed no API change at all.
- **The nonce is the security boundary.** Any program on the machine can
  register `golive://` and fire an unsolicited `#token=…` at us. Only a nonce
  naming a login currently in flight resolves anything. `lib/desktop.test.mts`
  pins that parser, rejections included.

The format is defined once in `lib/desktop.ts` and imported by both the
website and `main.ts`, rather than being a regex copied into two files.

## Layout

| File                | Role                                                            |
| ------------------- | --------------------------------------------------------------- |
| `main.ts`           | Window, screen picker, OAuth, deep links, navigation guards      |
| `preload.ts`        | The only surface the website sees (`window.golive`)              |
| `picker-preload.ts` | The picker window's bridge — separate, and deliberately narrower |
| `picker.html`       | Fallback screen/window chooser                                   |
| `channels.ts`       | IPC channel names, shared so a rename cannot desync the sides    |
| `systemAudio.ts`    | Runs the capture helpers, mixes them, streams PCM to the renderer|
| `audioSettings.ts`  | The picker's "share screen sound" switch and per-app mute list   |
| `native/`           | The WASAPI capture helper — prebuilt and committed; own README   |
| `build.mjs`         | esbuild bundling — see the note below                            |
| `build/icon.png`    | 512×512 source icon; electron-builder derives `.ico`/`.icns`     |

The icon is the site's own `public/icon.png` scaled to the 512×512
electron-builder needs to generate the platform formats. Replace
`build/icon.png` to change it — the `.ico`/`.icns` are generated, not
committed.

`picker-preload.ts` is separate from `preload.ts` for a reason: the source
list contains the **title of every open window** on the machine, and the audio
panel behind it names **every program currently making a sound**. The website
loaded in the main window has no business seeing either — the source list
before a choice is made, and the application list at all.

## Scripts

```bash
npm run electron:dev        # build + run against http://localhost:3000
npm run electron:start      # build + run against production
npm run electron:typecheck  # tsc over the shell (esbuild does not type-check)
npm run electron:native     # just the WASAPI helper (electron:build runs it too)
npm run electron:pack       # unpacked build, for a quick look
npm run electron:dist       # real installers
```

## Two things that will bite you

**Sandboxed preloads cannot `require` relative modules.** A preload running
with `sandbox: true` gets a crippled `require` that resolves only `electron`
and a couple of builtins. `require("./channels")` throws at load time, the
preload never runs, and the bridge silently never appears — with no error in
the renderer. That is why `build.mjs` bundles each entrypoint with esbuild
instead of leaving `tsc` output as-is.

**electron-builder ignores `files` for `node_modules`.** It bundles every
production dependency regardless, so the `!node_modules/**/*` line in
`electron-builder.yml` is load-bearing: without it the installer ships all of
Next, React, sharp and their native binaries — 278 MB measured, versus 57 KB
for the shell.

## Updates — two halves, only one of which needs an installer

**The website updates itself.** Every screen, all the WebRTC, the whole
mesh/cascade implementation is loaded live from the deploy, so shipping a
front-end change reaches users on their next launch with nothing to install.
That is the wrapper architecture paying off, not a feature anyone had to
build.

The one caveat: a window left open for days keeps running the JavaScript it
loaded on launch, exactly like a browser tab nobody reloaded. `Ctrl/Cmd+R`
fixes it. Reloading automatically is deliberately *not* done — it would drop
a call in progress, which is a far worse outcome than slightly stale code.

**The shell needs an installer**, and that is what `updater.ts` handles:
`main.ts`, the preloads and the picker ship inside the executable. It polls
the same GitHub release the `/download` route reads, downloads in the
background, and then asks. Saying "Depois" is a real answer — the update
applies on the next ordinary quit either way, so nobody gets interrupted
mid-call and nobody is left behind.

Auto-update is inert in development (`app.isPackaged` is false), so
`electron:dev` never touches the network for it.

**Updates are differential, not whole-installer.** electron-builder ships a
`.blockmap` next to each build; the updater compares it against the installed
version and fetches only the changed blocks, falling back to a full download
when the old blockmap is missing or the diff is too large. This is also why
the macOS target builds a `zip` alongside the `dmg` — the dmg is what a
person downloads, the zip is what Squirrel.Mac can actually apply.

**A launch does not update before it runs.** Opening the app starts the
version already installed; the check happens shortly after, and the new
version takes effect on restart. The one case where a launch is already
current is when the previous session downloaded an update and quit — that is
`autoInstallOnAppQuit` doing its job.

> **macOS needs signing for this to work at all.** Squirrel.Mac refuses to
> apply an update to an unsigned bundle — silently. Windows and Linux update
> fine unsigned.

### When the update never takes — the Windows failure mode

Downloading is the reliable half. Applying is not, and it fails *silently* by
construction: `quitAndInstall` spawns the NSIS installer detached, considers
the job done as soon as the process has a pid, and quits. If the installer
then aborts, nothing anywhere finds out. The report looks like "I press the
green button, the app restarts, and the button is back."

Three ordinary causes, none of which announce themselves:

- **A per-machine install.** `oneClick: false` plus `perMachine: false` means
  the assisted installer *offers the choice*, so some people are in
  `C:\Program Files\GoLive`. electron-updater only elevates when the build
  declares `perMachine: true`, so the silent installer is spawned unelevated
  and cannot write there.
- **An unsigned build meeting Windows 11.** Smart App Control blocks unsigned
  executables outright and without a prompt. Windows 10 has no equivalent, so
  the same release updates fine there and never on the other machine.
- **A locked file.** `resources/golive-audiocap.exe` is a separate process the
  installer does not know to wait for.

`updater.ts` handles this by *checking its own work*: the attempted version is
written to `update-install.json` in `userData` before quitting, and the next
launch compares it with `app.getVersion()`. Not the version we tried to
install means it did not happen, and the next attempt escalates — silent, then
the **visible** installer (which can show a UAC prompt and be clicked
through), then `/download` opened in the browser. A per-machine install skips
straight to the visible installer, since a silent one there is known to be
hopeless. Ordinary quits are recorded the same way, because
`autoInstallOnAppQuit` is silent too and fails identically.

Everything the updater does goes to **`updater.log`** in the same directory —
`%APPDATA%\GoLive\updater.log` on Windows, `~/Library/Application
Support/GoLive` on macOS, `~/.config/GoLive` on Linux. That file is the thing
to ask a user for; there is no console attached to a packaged app, so without
it electron-updater's own diagnostics go nowhere.

## Releasing

A commit does **not** release anything. Releasing is a tag, and the work
happens in CI:

```bash
npm version patch     # bumps package.json, commits, and creates a v… tag
git push --follow-tags
```

That tag triggers `.github/workflows/release-desktop.yml`, which builds on
macOS, Windows and Linux in parallel and uploads to a **draft** GitHub
release. Nothing is live yet — press **Publish release** on GitHub when all
three finish, and only then do `/download` and the updater start seeing it.

CI is not a nicety here: a macOS build can only be produced on macOS, so
without it the Mac version could never ship from a Windows machine at all.

To build locally without releasing — `npm run electron:dist` — you get
installers in `electron/release/` and no upload (there is no `GH_TOKEN`).

The macOS target is a **universal** binary on purpose: browsers on Apple
Silicon still report "Intel Mac OS X", so `/download` cannot tell the
architectures apart and one file that runs on both is the only honest answer.

## Before shipping

- **Windows signing is not cosmetic.** Unsigned builds do not merely "trip
  SmartScreen" — on Windows 11, Smart App Control **blocks and deletes** them
  without a prompt, which takes the installer *and* every auto-update with it
  (see the failure mode above). SAC asks Microsoft's reputation graph, not
  "is there a signature", so a brand-new OV certificate does not fix it
  either; it has to accrue reputation first. The two routes that work
  immediately are **Azure Trusted Signing** (~US$10/month, chains to
  Microsoft's own roots) and an **EV certificate** (hardware token or cloud
  HSM, ~US$400/year).

  The release workflow is already wired for Trusted Signing and stays inert
  until the secrets exist: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`,
  `AZURE_CLIENT_SECRET` for Entra ID, then `AZURE_SIGN_ENDPOINT`,
  `AZURE_SIGN_ACCOUNT`, `AZURE_SIGN_PROFILE` for the certificate profile, and
  `AZURE_SIGN_PUBLISHER` for the certificate's CN. That last one is not
  optional: the key never leaves Azure, so electron-builder cannot read the
  CN out of a file, and without it `latest.yml` ships with no `publisherName`
  and the updater silently stops verifying what it downloads.

  A user who already hit SAC and switched it off is **permanently** fine —
  it cannot be re-enabled without reinstalling Windows — so their machine is
  no longer a test of whether this got fixed.
- **macOS signing** is a hard requirement rather than a polish item too:
  Squirrel.Mac refuses to update an unsigned bundle. `MAC_CSC_LINK` /
  `MAC_CSC_KEY_PASSWORD`, plus notarisation (`APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`).

## System audio, and why the room does not hear itself

A share with system audio captures *everything* the machine plays, GoLive
included — the participants' voices and the audio of whatever share is being
watched. Sent back out, that is an echo of the whole room.

Windows can capture the mix minus one process tree, and `native/` is a small
executable that does exactly that, excluding Electron's main process (which
covers Chromium's audio service, where all of the app's audio is actually
rendered). Its PCM comes back over IPC and `lib/desktopSystemAudio.ts` turns
it into an ordinary `MediaStreamTrack`. `native/README.md` has the details.

**The helper is committed as a prebuilt binary**, at
`native/bin/golive-audiocap.exe`, rebuilt and committed by CI whenever its
source changes. Nobody needs MSVC and a Windows SDK to clone, run or package
this app — which matters most on macOS and Linux, where installing them is
not an option and a Windows build still has to be packageable. A `.sha256`
beside it records which `audiocap.cpp` it came from, so a stale binary is
reported instead of silently used.

Three things about the handoff are worth knowing before touching it:

- **The site starts the capture before calling `getDisplayMedia`.** A capture
  already running is precisely how `setDisplayMediaRequestHandler` knows to
  withhold Electron's own loopback track from that request — attaching both
  would put the echo right back.
- **The bridge is absent, not false, where this cannot work.** The preload
  exposes `window.golive.systemAudio` only when main says the machine is
  capable, so the website's check is "does this exist". That keeps both
  version-skew directions working: an old site in a new shell never arms it
  and gets ordinary loopback, and a new site in an old shell finds nothing to
  arm.
- **Everything GoLive plays is excluded, not just the voices** — the chimes,
  an embedded YouTube tile. There is no process-level distinction to make,
  and it is the right outcome anyway: everyone in the room already hears
  those locally.

## Known platform limits

- **System audio** is Windows-only. Electron's loopback capture has no
  equivalent on macOS or Linux without a virtual audio device, and asking for
  it anyway fails the *whole* capture rather than just the audio — so the
  handler requests video alone there. The web app already degrades that way
  for Firefox, so nothing extra was needed on its side.
- **Excluding GoLive from that capture is decided at runtime, not by
  version.** Microsoft documents process loopback as needing build 20348,
  which looks like "Windows 11 only" — but that is Server 2022's build, and
  the API is reported working on Windows 10 22H2, where only
  `GetMixFormat`/`IsFormatSupported` fail. The helper calls neither, so the
  shell asks the machine instead of a build number: it waits for the helper
  to report `READY` and falls back to Electron's loopback if it does not.
  Resist adding a version check here — guessing high silently disables the
  feature on machines that support it. macOS and Linux have no system audio
  to exclude in the first place.
- **macOS screen recording** requires the user to grant permission in System
  Settings the first time, and the app must be restarted afterwards. That is
  the OS's behaviour, not something the shell can smooth over.
