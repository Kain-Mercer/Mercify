# Developing Mercify

Technical notes for building and changing Mercify. Players don't need any of this; see the main [README](../README.md).

## How it fits together

```
 Spotify (SpotX + Spicetify)                 Mercify
 ┌──────────────────────────┐   ws://127.0.0.1:7317   ┌──────────────────────────────┐
 │ overlay-bridge.js        │ ──── now playing ─────▶ │ transparent, always-on-top    │
 │ (Spicetify extension)    │ ◀─── play / search ──── │ window covering your monitor  │
 └──────────────────────────┘                         └──────────────────────────────┘
```

- The Spicetify extension runs inside Spotify and talks to the client's own player, library and search. It doesn't use the Spotify Web API, so there's no developer app, no Premium requirement and no 10-result search cap.
- Mercify (Electron) runs the WebSocket server, draws the panels, and stays click-through everywhere except over a panel.
- A tiny native helper, `fgwatch.exe`, reports which window is in front so Mercify can show only over chosen games. It prints a JSON line on every change and every 2 s: `{"pid","hwnd","mon","exe","title"}`, where `mon` is the `MonitorFromWindow` handle. Writing `anchor <hwnd>` to its stdin adds `"anchor":{"hwnd","alive","iconic","visible","mon"}` for that window. It exits by itself when Mercify quits.
- **Gate:** `tickGate()` in `main.js` (every 200 ms). A chosen app in front opens the gate and becomes the anchor (`foreground.setAnchor`). Another app in front closes it, unless `onlyShowOver.stayOnOtherMonitor` is on and the anchor is up (alive, visible, not minimised) on a different monitor from the window in front. Mercify's own windows and an unknown foreground leave the gate as it is. Gated hotkeys follow the game being in front (`gameInFront`), not the gate, so they're released while you use the other monitor. To test off Windows, `OVERLAY_DEBUG_FG_FILE` takes the same JSON plus `"windows":{"<hwnd>":{"alive","iconic","visible","mon"}}` for the anchor; `OVERLAY_DEBUG_STATE_FILE` reports `gateWhy` (`game`, `other-monitor`, `other-app`, ...). It also has two one-shot modes: `--hide <exe> <waitMs>` waits for that program's main window (visible, titled, unowned), hides it and prints `{"hidden":[hwnd,...]}`; `--show <hwnd>...` shows them again. Mercify uses these to send Spotify's window to the tray once the bridge first says hello (only within 2 minutes of Mercify starting, and only if `minimiseSpotify` is on), and for the tray's **Show Spotify window**.
- **Launch behaviour:** opened by the user, Mercify shows Settings. Started at Windows login it's launched with `--autostart` (registered via `setLoginItemSettings`) and stays in the tray unless setup needs attention. Spotify is started with its own `--minimized` flag.

## Building

**On GitHub:** every push to `main` runs the [Build Windows exe](../.github/workflows/build.yml) workflow on a Windows runner. To publish a release, bump `version` in `overlay/package.json` and push: when there's no `v<version>` release yet, the workflow publishes one with both exes, `latest.yml` and the installer's `.blockmap` attached. Other builds attach the same files to the run (Actions tab → the run → **Artifacts**). Changes to Markdown files and `docs/` don't trigger a build. Before releasing, the build runs `tools/check-package.js`, which fails if any `require()` in the packaged app points at a file or package that didn't get packaged. All top-level `overlay/*.js` files are packaged automatically.

## Updates

`overlay/updater.js` handles updates; installed copies use electron-updater with the GitHub provider (`build.publish` in `package.json`, which bakes `app-update.yml` into the app).

- **Installer builds** check the latest *published, non-prerelease* release 15 s after start and every 6 h. They read `latest.yml`, download the new `Mercify-Setup-x.y.z.exe` in the background (differentially via the `.blockmap` when the previous release has one), verify its SHA-512, and install silently when Mercify quits, or immediately with **Restart and update**, which relaunches the app.
- **Portable builds** (detected by `PORTABLE_EXECUTABLE_FILE`) only call the GitHub releases API and offer a download link.
- **Running from source:** updates are off.
- The exe isn't code-signed, so there's no publisher check on downloads (`publisherName` isn't set): integrity comes from the SHA-512 in `latest.yml` served over HTTPS from GitHub. Protect the GitHub account (2FA); anyone who can publish a release can ship an update.
- Releases must stay **published** (not draft or pre-release), and the release must include `latest.yml`, or installed copies won't see it. Don't rename release assets.

To test locally, serve a folder containing `latest-linux.yml` (the updater names its feed file after the OS it runs on; Windows uses `latest.yml`) and a matching exe, put a `dev-app-update.yml` (`provider: generic`, `url`, `updaterCacheDirName`) in `overlay/`, and run with `OVERLAY_DEBUG_UPDATE_FEED=<url>`. `OVERLAY_DEBUG_UPDATE_MODE=portable` with `OVERLAY_DEBUG_RELEASE_API=<url>` tests the portable check.

**Locally on Windows:** double-click `build-exe.bat`. The exes land in `overlay\dist`.

**From source** (Node.js 22.12 or newer; Electron 44 needs it):

```
cd overlay
npm install
npm start          # run from source
npm run demo       # (second terminal) a fake Spotify with a made-up library
npm run dist       # build the installer and portable exe into overlay\dist
```

`setup-and-run.bat` is the older all-in-one script that runs everything from source. `install-bridge.ps1` installs just the Spicetify extension by hand.

The helper is rebuilt with MinGW (`x86_64-w64-mingw32-gcc -O2 -municode -static -s -o bin/fgwatch.exe native/fgwatch.c`) or MSVC (`cl /O2 fgwatch.c user32.lib`). A prebuilt copy lives in `overlay/bin`.

## Listening lobbies

`overlay/lobby.js` (no Electron dependency) implements lobbies; `main.js` wires it to the bridge and the UI.

- **Transport:** MQTT over secure WebSockets to several public relays at once (`DEFAULT_RELAYS`: EMQX, Mosquitto, HiveMQ; HiveMQ can take 10+ s to connect). Every message is published to every connected relay and de-duplicated on receipt by `(sender id, sequence number)`. `lobbyRelays` in `config.json` overrides the list (for example with your own Mosquitto or EMQX).
- **Privacy:** topic = `mercify/v1/` + SHA-256(`"mercify-topic-v1:" + code`)[:32 hex]. Payloads are AES-256-GCM with a key from scrypt(code, `"mercify-lobby-v1"`, N=16384). Anyone with the code can read and join; others see random topics and ciphertext. Codes are normalised to A-Z/0-9 (4-16 characters); generated codes are 8 characters from a 31-letter alphabet.
- **Messages:** `hello` (joining), `here` (heartbeat every 8 s, carries role), `bye`, `state` (host only: uri, position, playing, sentAt; on every change, on seeks and every 5 s), `ping`/`pong` (clock offset to the host, median of recent samples, re-measured when the host changes), `suggest` (to the host, queued with `addToQueue`).
- **Roles:** a joiner listens for 2.5 s; if no host answers, it becomes host. Host = earliest `joinedAt` (each member's own clock), ties by id; everyone computes the same answer, so host hand-over on `bye` or a 25 s silence needs no negotiation, and two simultaneous hosts resolve themselves.
- **Session playlist:** the host owns `queue` (up next), `history` (played, newest first) and `now` (the queued item playing, so its "added by" shows) and broadcasts them in a `queue` message on every change, to newcomers, and every 15 s. Listeners add with `suggest` (track info; the host builds the item with the sender's name/id) and remove their own items with `queue-op`. Items from the network are rebuilt by `makeItem` (URI pattern, https-only images, length limits). The host plays the next item 350 ms before the current song ends (`scheduleAdvance`). While the list has songs it's in charge: any song change the host's Spotify makes on its own (its next song, crossfade or Automix starting early) is replaced with the next item, unless the host picked the song in Mercify within the last 4 s (`markManual`, called by `main.js` for overlay `playTrack`/`playContext`/`next`/`prev`). If Spotify happens to move on to exactly the next item, it's taken as played. The host's Next plays from the list when it isn't empty. A new host carries on with its copy of the list.
- **Following:** listeners play the host's song, seek to the host's position (adjusted by the clock offset), match play/pause, and re-seek when more than 2 s off. Host messages are applied immediately; the listener's own player reports are ignored for 1.5 s after a correction, and out-of-order host messages are dropped.
- **Testing:** `tools/lobby-test.js` runs three members in separate processes with clocks up to 7 s apart against real relays (`LOBBY_RELAYS=ws://127.0.0.1:9001,...` for local Mosquitto instances), covering sync, seek, pause, song change, suggestions, losing a relay, encryption, host leave and host crash. The [Check lobby relays](../.github/workflows/lobby-relays.yml) workflow runs it against the public relays weekly and on demand, and reports each relay as a run annotation.

## Configuration file

`%APPDATA%\Mercify\config.json` (layout is in `layout.json`). Settings from the earlier "Spotify Overlay" name are migrated on first run.

| Key | Meaning |
|---|---|
| `hotkeys` | `toggle`, `edit`, `search`, plus optional `playPause`, `next`, `prev`, in Electron accelerator syntax (`"Alt+F9"`, `"Control+Shift+P"`). Restart after editing. |
| `onlyShowOver` | `enabled`, `apps` (program names, case-insensitive), `titles` (exact window titles) and `stayOnOtherMonitor` (keep showing while you use a window on another monitor, default `true`). |
| `hotkeysOnlyOverApps` | Release the gated hotkeys when no listed app is in front. The Edit Mode hotkey is always registered. |
| `launchSpotify` | Start Spotify with Mercify. |
| `minimiseSpotify` | Hide Spotify's window to the tray when Mercify opens. |
| `lobbyName` | Your name in listening lobbies. |
| `lobbyRelays` | Optional list of `wss://` MQTT relays to use instead of the public ones (everyone in a lobby must share at least one). |
| `display` | `"primary"`, `"cursor"`, or a 0-based monitor index. |
| `port` | WebSocket port (default 7317). The extension reads `localStorage["overlay-bridge:port"]` if you change it. |
| `disableHardwareAcceleration` | Set `true` if transparency shows as black on your GPU driver. |

`Ctrl+Alt` hotkeys are avoided by default because `Ctrl+Alt` is AltGr on Polish and many other keyboard layouts.

## Debugging

- Spotify side: run `spicetify enable-devtools`, press `Ctrl+Shift+I` in Spotify and look for `[overlay-bridge]` log lines. Empty searches also list each method tried in the results panel.
- Test hooks (environment variables, used for headless testing): `OVERLAY_DEBUG_CAPTURE`, `OVERLAY_DEBUG_JS`, `OVERLAY_DEBUG_RESULT`, `OVERLAY_DEBUG_EDIT`, `OVERLAY_DEBUG_SETTINGS_CAPTURE`, `OVERLAY_DEBUG_FAKE_SETUP`, `OVERLAY_DEBUG_FG_FILE`, `OVERLAY_DEBUG_STATE_FILE`, `OVERLAY_DEBUG_UPDATE_FEED`, `OVERLAY_DEBUG_UPDATE_MODE`, `OVERLAY_DEBUG_UPDATE_DELAY`, `OVERLAY_DEBUG_RELEASE_API`, `OVERLAY_DEBUG_USERDATA` (run a second copy with its own settings), `OVERLAY_DEBUG_LOBBY_RELAYS`, `OVERLAY_DEBUG_LOBBY_TRACE`.

## Focus and click-through

The overlay window stays `focusable: true`: on Windows, Chromium discards clicks on a window that can't be activated (`focusable: false` caused the 1.3.0 "can't click anything" bug). Clicking a panel therefore activates the overlay, and the renderer then sends `give-back-focus` about 120 ms after any click that didn't land in a text box; `win.blur()` on Windows activates the next window down, normally the game. Text boxes keep focus until `Enter`/`Esc` or a song is picked (`releaseFocus()`), and the search hotkey and the playlist filter use `takeFocus()` via `want-focus`. Click-through is decided per mouse move in the renderer; while hidden, only the compact Now Playing panel (`.live-hidden`) takes clicks.
