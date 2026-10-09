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
- A tiny native helper, `fgwatch.exe`, reports which window is in front so Mercify can show only over chosen games. It exits by itself when Mercify quits.

## Building

**On GitHub:** every push to `main` runs the [Build Windows exe](../.github/workflows/build.yml) workflow on a Windows runner. To publish a release, bump `version` in `overlay/package.json` and push: when there's no `v<version>` release yet, the workflow publishes one with both exes attached. Other builds attach the exes to the run (Actions tab → the run → **Artifacts**). Changes to Markdown files and `docs/` don't trigger a build.

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

## Configuration file

`%APPDATA%\Mercify\config.json` (layout is in `layout.json`). Settings from the earlier "Spotify Overlay" name are migrated on first run.

| Key | Meaning |
|---|---|
| `hotkeys` | `toggle`, `edit`, `search`, plus optional `playPause`, `next`, `prev`, in Electron accelerator syntax (`"Alt+F9"`, `"Control+Shift+P"`). Restart after editing. |
| `onlyShowOver` | `enabled`, `apps` (program names, case-insensitive) and `titles` (exact window titles). |
| `hotkeysOnlyOverApps` | Release the gated hotkeys when no listed app is in front. The Edit Mode hotkey is always registered. |
| `launchSpotify` | Start Spotify with Mercify. |
| `display` | `"primary"`, `"cursor"`, or a 0-based monitor index. |
| `port` | WebSocket port (default 7317). The extension reads `localStorage["overlay-bridge:port"]` if you change it. |
| `disableHardwareAcceleration` | Set `true` if transparency shows as black on your GPU driver. |

`Ctrl+Alt` hotkeys are avoided by default because `Ctrl+Alt` is AltGr on Polish and many other keyboard layouts.

## Debugging

- Spotify side: run `spicetify enable-devtools`, press `Ctrl+Shift+I` in Spotify and look for `[overlay-bridge]` log lines. Empty searches also list each method tried in the results panel.
- Test hooks (environment variables, used for headless testing): `OVERLAY_DEBUG_CAPTURE`, `OVERLAY_DEBUG_JS`, `OVERLAY_DEBUG_EDIT`, `OVERLAY_DEBUG_SETTINGS_CAPTURE`, `OVERLAY_DEBUG_FAKE_SETUP`, `OVERLAY_DEBUG_FG_FILE`, `OVERLAY_DEBUG_STATE_FILE`.

## Files

```
spicetify/overlay-bridge.js     Spicetify extension (runs inside Spotify)
overlay/main.js                 overlay window, click-through, app detection, hotkeys, tray, WebSocket server
overlay/setup.js                setup checks and installers used by Settings
overlay/foreground.js           reads fgwatch.exe's "app in front" reports
overlay/native/fgwatch.c        helper source (prebuilt in overlay/bin/fgwatch.exe)
overlay/settings/               Settings window
overlay/renderer/               panels, Edit Mode, styles
overlay/tools/mock-bridge.js    fake Spotify for testing (npm run demo)
build-exe.bat                   builds the installer and portable exe on Windows
setup-and-run.bat               older run-from-source script
install-bridge.ps1              installs just the extension
.github/workflows/build.yml     builds the exe on GitHub; releases on a version bump
```
