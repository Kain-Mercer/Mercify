<p align="center"><img src="docs/logo.png" width="260" alt="Mercify" /></p>

<p align="center"><b>Your Spotify, right inside your game.</b><br/>See what's playing, search for songs and pick from your playlists without ever alt-tabbing.</p>

> **⚠️ For evaluation only.** Mercify is an early test release, provided as-is with no warranty. Use it at your own risk. See the [disclaimer](#disclaimer) below.

---

## What it does

Mercify puts small, see-through Spotify panels on top of your game, a bit like the Discord overlay:

- **Now Playing:** album art, the song, a seek bar, and play/pause, skip, shuffle, repeat, like and volume buttons. Shrink it to a small **compact** bar that you can still click while the rest of the overlay is hidden.
- **Search:** type a song, artist or playlist and click a result to play it.
- **Playlist:** browse any of your playlists or Liked Songs and click a song to play it.
- **Listening lobbies:** share a code with friends and listen to the same music at the same time, each through your own Spotify.

You choose where each panel goes and how see-through it is. Mercify only appears while you're in your game (World of Warcraft by default), and hides itself when you switch to anything else.

It works with a **free** Spotify account.

## Before you start

You'll need:

- **Windows 10 or 11**
- **The Spotify desktop app.** If you don't have it, Mercify can install it for you. The version from the Microsoft Store won't work.
- **Your game set to "Windowed (Fullscreen)" or "Borderless"** in its graphics settings. Mercify can't appear over games running in true fullscreen.

## Install

1. Go to the [**Releases page**](https://github.com/Kain-Mercer/Mercify/releases) and download **`Mercify-Setup`** (the newest version at the top).
2. Run it. If Windows shows a blue "Windows protected your PC" box, click **More info**, then **Run anyway**. This appears because Mercify is new and not yet recognised by Windows.
3. Mercify opens a **Settings** window with a short checklist. Work through it from top to bottom, clicking each button that appears:
   - **Spotify desktop app**: installs Spotify if you don't have it yet.
   - **SpotX**: an add-on for Spotify that Mercify relies on. Install it before the next step. If Mercify just installed Spotify for you in the step above, SpotX is already included, so skip this one.
   - **Spicetify**: another add-on that lets Mercify talk to Spotify. When it asks about "Marketplace", you can answer either way.
   - **Mercify extension**: connects Spotify to Mercify. Spotify restarts once.

   Some steps open a separate window that asks you questions. Answer them, and when that window closes the checklist updates. When Spotify, Spicetify and the Mercify extension all show a green dot, you're done. (The SpotX dot always stays grey, because Mercify can't tell whether SpotX is installed.)
4. Start your game. Your Spotify panels appear on top of it.

Whenever you open Mercify, it opens Spotify for you (if it isn't running yet) and tucks Spotify's own window away into the tray, since Mercify's panels do its job. To bring Spotify's window back, right-click the Mercify tray icon and choose **Show Spotify window**.

Prefer not to install anything? Download **`Mercify-portable`** instead. It runs straight from the file, but starts a little slower and can't update itself (see [Updates](#updates)).

## Using Mercify

### Keyboard shortcuts

| Press | To |
|---|---|
| `Ctrl` + `` ` `` | Show or hide the panels (the `` ` `` key is under `Esc`) |
| `Ctrl` + `Shift` + `` ` `` | Enter Edit Mode, to move and resize the panels |
| `Ctrl` + `Shift` + `Space` | Jump to the search box. Type, then press `Enter` to play the top result, or `Esc` to go back to your game |

These shortcuts only work while you're in your game, so they won't get in the way of other programs. The Edit Mode shortcut works everywhere.

### Arranging your panels (Edit Mode)

Press `Ctrl` + `Shift` + `` ` `` to enter Edit Mode. It works much like World of Warcraft's own Edit Mode:

- **Drag** a panel to move it, or drag its edges or corner to resize it. Panels line up neatly with each other and the screen edges. Hold `Alt` while dragging if you'd rather place them freely.
- Use the **arrow keys** to nudge the selected panel one step at a time.
- **Click** a panel to change its settings:
  - Turn it on or off
  - Set how see-through it is normally
  - Set how see-through it is when you hide the overlay. For example, keep Now Playing faintly visible while everything else disappears.
  - Make it bigger or smaller

Press `Esc` or **Done** when you're finished. Your layout saves automatically.

### Compact Now Playing

Hover over the Now Playing panel and click the small arrows in its top-right corner to shrink it into a compact bar showing the song and the previous, play/pause and next buttons. Click the arrows on the compact bar to make it full size again. It shrinks and grows in place, towards the nearest corner of your screen. You can also switch it with **Compact view** in Edit Mode, and move and resize the compact bar there like any other panel.

When you hide the overlay with `Ctrl` + `` ` ``, the compact bar stays on screen at its "hidden" see-through level and **still works**: you can pause or skip without bringing everything back. It brightens while your mouse is over it. (To hide it completely too, set its *Opacity when hidden* to 0% in Edit Mode.)

Clicking Mercify's buttons doesn't take your keyboard away from the game, so you can keep moving right after you skip a song. Only typing in a search box does, and pressing `Enter` or `Esc`, or picking a song, gives the keyboard straight back.

### Using it with other games

Mercify shows up over World of Warcraft out of the box. To use it with another game:

1. Click the Mercify icon in your system tray (bottom-right of the taskbar) to open **Settings**.
2. Under **Only show over these apps**, press **Pick the app in front**.
3. Within 5 seconds, click into your game. It's added to the list.

If you'd rather Mercify always stayed visible, switch **Only show over these apps** off.

### Other settings

Open **Settings** from the tray icon to:

- Start Mercify automatically when Windows starts. It then waits quietly in the tray instead of opening its Settings window.
- Open Spotify automatically when Mercify starts
- Choose whether Spotify's window is minimised to the tray when Mercify opens
- Re-run any setup step if something stops working

## Listening lobbies

Listen along with friends: everyone hears the same song at the same moment, each in their own Spotify. It works with free accounts, and everyone needs Mercify.

**Start or join a lobby**

1. Open the **Lobby** panel in the overlay. If you can't see it, turn it on in Edit Mode.
2. Enter **your name**. This is what others in the lobby see, and you can also set it in Settings.
3. Enter a **lobby code**: make one up, or press the dice button to generate a random one.
4. Press **Join lobby**.

Everyone who enters the same code ends up in the same lobby. If nobody's there yet, you've started it and you're the **host**. Share the code with your friends (the copy button next to it helps), and they join by entering it.

**Who controls the music**

- **The host** plays, pauses, skips and seeks as normal, and everyone in the lobby follows along within a second or two.
- **Everyone else listens.** Clicking a song suggests it to the host and adds it to the host's queue, and the host sees who suggested what. Play, pause and skip are greyed out for listeners, but you can still change your own volume.
- If the host leaves, whoever has been in the lobby longest becomes the new host automatically.

The Now Playing panel shows a small badge while you're in a lobby. You can leave the lobby from the Lobby panel, from Settings or from the tray icon.

**Good to know**

- Random codes are safest. Short, made-up codes like `RAID` are easy for strangers to guess, and anyone who knows a code can join.
- Lobby messages travel through free public relay servers, the same kind many apps use for chat. They're **encrypted with your lobby code**, so the relay can't see your name or what you're playing, but they're run by third parties and can occasionally be slow or down. Mercify uses several at once in case one is having a bad day.
- Songs that aren't available in a listener's country, and the host's own local files, can't be played along.

## Updates

Mercify keeps itself up to date. A few times a day it checks for a new version, downloads it quietly in the background, and installs it the next time Mercify closes. You'll get a Windows notification when an update is ready. If you don't want to wait, open **Settings** and click **Restart and update**, or choose **Restart to update** from the tray icon.

The **Updates** section in Settings shows which version you have and lets you check for a new one.

- **Upgrading from version 1.2.0 or earlier?** Those versions can't update themselves, so download and run the newest `Mercify-Setup` from the [Releases page](https://github.com/Kain-Mercer/Mercify/releases) one last time. Your layout and settings are kept. From then on, updates are automatic.
- **Using the portable version?** It can't replace itself while it's running. Instead, Settings tells you when a new version is out and gives you a **Download** button. Replace your old file with the new one.

## Troubleshooting

**The panels say "Waiting for Spotify".** Make sure Spotify is open. If it is, open Settings and press **Reinstall** next to *Mercify extension*. This is most often needed after Spotify updates itself.

**I can't see the panels in my game.** Check that your game is set to *Windowed (Fullscreen)* or *Borderless*, not *Fullscreen*. Also check the game is listed under **Only show over these apps** in Settings.

**The panels have a black box behind them.** Some graphics drivers cause this. Contact us via the Issues page and we'll help you switch on a fix.

**Can't join a lobby ("Couldn't reach any lobby relay").** A firewall or school or work network may be blocking the relays. They use ports 8084, 8884 and 8081. Try another network, such as your phone's hotspot, to check.

**A shortcut doesn't work.** Another program may already be using it. Mercify tells you when it starts if a shortcut couldn't be set up.

**Something else is wrong?** Please [open an issue](https://github.com/Kain-Mercer/Mercify/issues) and describe what happened. A screenshot helps a lot.

## Disclaimer

Mercify is provided **for evaluation purposes only**. It is test software, offered "as is", without warranty of any kind. It may contain bugs, may stop working at any time, and could affect how Spotify behaves on your computer. You use it entirely at your own risk, and the authors accept no responsibility for any loss, damage or account issues that may result.

Mercify is an independent project. It is **not affiliated with, endorsed by or supported by** Spotify, Blizzard Entertainment, the SpotX project or the Spicetify project. All trademarks belong to their respective owners.

Listening lobbies send messages, encrypted with your lobby code, through free public relay servers run by third parties (EMQX, HiveMQ and the Eclipse Mosquitto project). Mercify isn't affiliated with them and can't guarantee they're available.

Mercify relies on third-party tools (SpotX and Spicetify) that modify the Spotify desktop app. Modifying Spotify may go against Spotify's Terms of Use. Please review them and decide for yourself before installing. Mercify doesn't modify, read or inject anything into your games. It simply draws a window on top of them.

---

<sub>Want to build Mercify yourself or help develop it? See the [developer guide](docs/DEVELOPING.md).</sub>
