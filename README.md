<p align="center"><img src="docs/logo.png" width="260" alt="Mercify" /></p>

<p align="center"><b>A Discord-style in-game overlay for Spotify.</b><br/>Now playing, search and your playlists, floating over your game. Free accounts welcome.</p>

---

Mercify shows only the parts of Spotify you want (now playing, a search bar, search results and one playlist) as panels on top of your game. You can drag them around in a WoW-style Edit Mode, fade them in and out with a hotkey, and have them appear only while WoW (or another app you choose) is in front.

It works with a **free** Spotify account and a **SpotX** client. It doesn't use the Spotify Web API, so there's no developer app, no Premium requirement and no 10-result search cap.

```
 Spotify (SpotX + Spicetify)                 Mercify
 ┌──────────────────────────┐   ws://127.0.0.1:7317   ┌──────────────────────────────┐
 │ overlay-bridge.js        │ ──── now playing ─────▶ │ transparent, always-on-top    │
 │ (Spicetify extension)    │ ◀─── play / search ──── │ window covering your monitor  │
 └──────────────────────────┘                         └──────────────────────────────┘
```

The extension runs inside Spotify and talks to the client's own player, library and search. Mercify draws the panels and stays click-through everywhere except over a panel.

## Install (Windows)

Download **`Mercify-Setup-x.y.z.exe`** from [Releases](https://github.com/Kain-Mercer/Mercify/releases) and run it. It installs for your user only, so there's no admin prompt (Spicetify refuses to run as admin anyway). It also adds Start menu and desktop shortcuts. Prefer not to install anything? **`Mercify-x.y.z-portable.exe`** runs as a single file, but starts a few seconds slower because it unpacks itself each launch.

The exe isn't code-signed, so Windows SmartScreen may warn the first time: choose **More info → Run anyway**.

On first launch, **Settings** opens with a setup checklist:

1. **Spotify desktop app**: if it's missing, **Install with SpotX** installs Spotify already patched.
2. **SpotX**: run it before Spicetify. Running it again reinstalls Spotify.
3. **Spicetify**: **Install Spicetify** opens its installer. It asks about Marketplace, and either answer is fine.
4. **Mercify extension**: **Install** copies the bridge extension into Spicetify and applies it, which restarts Spotify once.

The installers open in their own window, because they ask questions. The checklist updates when they close. Settings opens again by itself whenever something needs attention, for example when a new version ships an updated extension. You can reopen it any time by clicking the tray icon.

## Only show over games

By default Mercify only appears while WoW is the window in front, and hides over your browser, Discord and everything else. It recognises these programs:

`Wow.exe`, `WowClassic.exe`, `Wow-64.exe`, `WowB.exe`, `WowT.exe`, `Ascension.exe`, plus any window titled exactly **World of Warcraft**.

To add another game, open Settings, press **Pick the app in front**, and click into the game within 5 seconds. You can also type a program name (`Something.exe`) or an exact window title. Title matching is exact on purpose, so a browser tab called "World of Warcraft - Wowhead" doesn't count.

- **Edit Mode always shows the overlay**, wherever you are, so you can set things up.
- **Hotkeys only work over these apps** (on by default). Outside the game, the show/hide and search hotkeys are released, so other programs can use them, like VS Code's terminal. The Edit Mode hotkey always works.
- Switch the feature off in Settings, or with **Only show over games** in the tray menu.

A tiny helper, `fgwatch.exe` (source in `overlay/native/fgwatch.c`), reports which window is in front. It closes by itself when Mercify quits.

## Hotkeys

| Default | What it does |
|---|---|
| `Ctrl` + `` ` `` | Show / hide. Each panel fades to its own "hidden" opacity, and everything becomes click-through. |
| `Ctrl` + `Shift` + `` ` `` | Edit Mode |
| `Ctrl` + `Shift` + `Space` | Search: puts the cursor in the search bar. `Enter` plays the top song, `Esc` clears the search (press it again to go back to the game). |

To change these, or add `playPause`, `next` and `prev` hotkeys, use **Change in settings file** in Settings and restart Mercify. The format is Electron's accelerator syntax, for example `"Alt+F9"` or `"Control+Shift+P"`. If another app already owns a hotkey, you get a message on startup.

`Ctrl+Alt` combos are avoided on purpose. On a Polish keyboard (and many others) `Ctrl+Alt` is AltGr, so they would swallow ą, ę, ś and other letters.

## Edit Mode

Edit Mode works much like WoW's:

- Drag a panel to move it. Drag its right or bottom edge, or the corner, to resize it.
- Panels snap to a 16px grid, to the screen edges and centre, and to the edges of other panels. Blue guide lines show what you snapped to. Hold `Alt` while dragging to skip snapping.
- Arrow keys nudge the selected panel by 1px. Hold `Shift` to nudge by 10px.
- Clicking a panel opens its settings:
  - **Show this panel**
  - **Opacity when shown**
  - **Opacity when hidden**: this sets what the toggle hotkey does to that panel. For example, keep Now Playing at 75% while the playlist and search disappear.
  - **Scale**
  - **Only show while searching** (results panel only)
- `Esc` or **Done** leaves Edit Mode. The layout saves automatically.

## Panels

- **Now Playing:** cover art, title, artist, a seek bar you can click, shuffle, previous, play/pause, next, repeat, like and volume. Controls drop away as the panel gets narrow or short.
- **Search Bar** and **Search Results:** songs (click to play, **+** to queue), playlists (click to open them in the Playlist panel) and albums (click to play). If a search comes back empty, the panel lists what it tried and why.
- **Playlist:** any playlist from your library (folders included) or Liked Songs. Clicking a song plays it inside the playlist, so "next" continues through the list.

Settings and layout are stored in `%APPDATA%\Mercify\` (`config.json`, `layout.json`). Settings from the earlier "Spotify Overlay" name are carried over automatically.

## Known limits

- **Exclusive fullscreen games** draw over every normal window, this one included. Set the game to **borderless windowed**. Discord gets around this by injecting into the game's renderer, which Mercify deliberately doesn't do (anti-cheat).
- **Black background instead of transparent:** some Windows GPU drivers do this. Add `"disableHardwareAcceleration": true` to `config.json` and restart.
- **Spotify updates can break the bridge.** SpotX blocks updates, which helps. If Mercify sits on "Waiting for Spotify" after an update, reinstall the extension from Settings. If that fails, run SpotX again and then reinstall the extension. To look inside Spotify, run `spicetify enable-devtools`, press `Ctrl+Shift+I` in Spotify and look for `[overlay-bridge]` lines.

## Building

**On GitHub:** push a tag such as `v1.2.0` and the [Build Windows exe](.github/workflows/build.yml) workflow builds both exes on Windows and publishes them as a release. You can also start it from the Actions tab (**Run workflow**) to get the exes as a download without making a release.

**Locally on Windows:** double-click `build-exe.bat`. The exes land in `overlay\dist`.

**From source** (Node.js 22.12 or newer):

```
cd overlay
npm install
npm start          # run from source
npm run demo       # (second terminal) a fake Spotify with a made-up library
npm run dist       # build the installer and portable exe into overlay\dist
```

`setup-and-run.bat` is the older all-in-one script that runs everything from source. `install-bridge.ps1` installs just the extension by hand.

The helper is rebuilt with MinGW (`x86_64-w64-mingw32-gcc -O2 -municode -static -s -o bin/fgwatch.exe native/fgwatch.c`) or MSVC (`cl /O2 fgwatch.c user32.lib`). A prebuilt copy is in `overlay/bin`.

## Files

```
spicetify/overlay-bridge.js     Spicetify extension (runs inside Spotify)
overlay/main.js                 overlay window, click-through, app detection, hotkeys, tray, WebSocket server
overlay/setup.js                setup checks and installers used by Settings
overlay/foreground.js           reads fgwatch.exe's "app in front" reports
overlay/native/fgwatch.c        source of the helper (prebuilt in overlay/bin/fgwatch.exe)
overlay/settings/               Settings window
overlay/renderer/               panels, Edit Mode, styles
overlay/tools/mock-bridge.js    fake Spotify for testing (npm run demo)
build-exe.bat                   builds the installer and portable exe on Windows
setup-and-run.bat               older run-from-source script
install-bridge.ps1              installs just the extension
.github/workflows/build.yml     builds and releases the exe on GitHub
```
