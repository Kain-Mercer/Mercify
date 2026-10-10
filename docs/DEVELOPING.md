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

**On GitHub:** every push to `main` runs the [Build Windows exe](../.github/workflows/build.yml) workflow on a Windows runner. To publish a release, bump `version` in `overlay/package.json` and push: when there's no `v<version>` release yet, the workflow publishes one with both exes, `latest.yml` and the installer's `.blockmap` attached. Other builds attach the same files to the run (Actions tab → the run → **Artifacts**). Changes to Markdown files and `docs/` don't trigger a build.

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
- Test hooks (environment variables, used for headless testing): `OVERLAY_DEBUG_CAPTURE`, `OVERLAY_DEBUG_JS`, `OVERLAY_DEBUG_RESULT`, `OVERLAY_DEBUG_EDIT`, `OVERLAY_DEBUG_SETTINGS_CAPTURE`, `OVERLAY_DEBUG_FAKE_SETUP`, `OVERLAY_DEBUG_FG_FILE`, `OVERLAY_DEBUG_STATE_FILE`, `OVERLAY_DEBUG_UPDATE_FEED`, `OVERLAY_DEBUG_UPDATE_MODE`, `OVERLAY_DEBUG_UPDATE_DELAY`, `OVERLAY_DEBUG_RELEASE_API`.

## Focus and click-through

The overlay window stays `focusable: true`: on Windows, Chromium discards clicks on a window that can't be activated (`focusable: false` caused the 1.3.0 "can't click anything" bug). Clicking a panel therefore activates the overlay, and the renderer then sends `give-back-focus` about 120 ms after any click that didn't land in a text box; `win.blur()` on Windows activates the next window down, normally the game. Text boxes keep focus until `Enter`/`Esc` or a song is picked (`releaseFocus()`), and the search hotkey and the playlist filter use `takeFocus()` via `want-focus`. Click-through is decided per mouse move in the renderer; while hidden, only the compact Now Playing panel (`.live-hidden`) takes clicks.
