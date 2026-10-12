<p align="center"><img src="docs/logo.png" width="240" alt="Mercify" /></p>

<p align="center"><b>Your Spotify, right inside your game.</b><br/>Skip songs, search and pick playlists without ever alt-tabbing.</p>

<p align="center"><a href="https://github.com/Kain-Mercer/Mercify/releases/latest/download/Mercify-Setup.exe"><b>⬇ Download Mercify</b></a></p>

<p align="center">
<a href="#get-started">🚀 Get started</a> ·
<a href="#using-mercify">🎮 Using it</a> ·
<a href="#listening-lobbies">👥 Lobbies</a> ·
<a href="#updates">🔄 Updates</a> ·
<a href="#uninstalling">🗑️ Uninstalling</a> ·
<a href="#troubleshooting">🛠️ Help</a> ·
<a href="#disclaimer">⚖️ Disclaimer</a>
</p>

## Get started

1. [**Download `Mercify-Setup`**](https://github.com/Kain-Mercer/Mercify/releases/latest/download/Mercify-Setup.exe) and run it.
   *If Windows says "Windows protected your PC", click **More info**, then **Run anyway**. It says that because Mercify is new.*
2. Press the big green **Set up everything** button and wait a few minutes. It sets up Spotify for you.
3. Log in to Spotify when it opens.
4. Start your game, set to **Windowed (Fullscreen)** or **Borderless**. Your music panels appear on top.

<details>
<summary><b>What you need</b></summary>

- **Windows 10 or 11.**
- **The Spotify desktop app.** If you don't have it, Mercify installs it for you. The Microsoft Store version won't work.
- **Your game in "Windowed (Fullscreen)" or "Borderless" mode.** Mercify can't appear over true fullscreen.

</details>

<details>
<summary><b>What "Set up everything" does, and if something goes wrong</b></summary>

It installs Spotify if you don't have it, plus the two add-ons Mercify needs to talk to Spotify (SpotX and Spicetify). It doesn't ask you anything, and the bar at the top shows how far along it is, so you can do something else meanwhile.

- At the end Spotify opens. Log in, and the last row, **Connected to Spotify**, turns green by itself. Spotify not showing? Press **Open Spotify** on that row.
- Spotify's window blank after you log in? That can happen the first time. Mercify notices and restarts Spotify for you a few seconds later.
- If something goes wrong, Settings says what in plain words, with a **Try again** button. **Copy details** copies everything that happened, to paste into a message or an [issue](https://github.com/Kain-Mercer/Mercify/issues).

Mercify doesn't install Spicetify's Marketplace (it isn't needed), so you won't see a Marketplace button in Spotify.

From then on, opening Mercify also opens Spotify and tucks Spotify's own window into the tray, since Mercify's panels do its job. To bring it back, right-click the Mercify tray icon and choose **Show Spotify window**.

</details>

<details>
<summary><b>The portable version</b></summary>

Prefer not to install anything? Download [**`Mercify-portable`**](https://github.com/Kain-Mercer/Mercify/releases/latest/download/Mercify-portable.exe) instead. It runs straight from the file, but starts a little slower and can't update itself: Settings tells you when there's a new version and gives you a **Download** button.

</details>

## Using Mercify

| Press | To |
|---|---|
| `Ctrl` + `` ` `` | Show or hide the panels (`` ` `` is the key under `Esc`) |
| `Ctrl` + `Shift` + `` ` `` | Move and resize the panels (Edit Mode) |
| `Ctrl` + `Shift` + `Space` | Jump to search. Type, then `Enter` plays the top result, or `Esc` takes you back to your game |

These only work while you're in your game, so they don't get in the way of other programs. The Edit Mode shortcut works everywhere. Clicking Mercify's buttons never takes the keyboard away from your game; only typing in a search box does, until you press `Enter` or `Esc` or pick a song.

<details>
<summary><b>The panels</b></summary>

- **Now Playing:** album art, the song, a seek bar, a volume slider, and play/pause, skip, shuffle, repeat and like buttons. Drag the seek bar or volume, or scroll your mouse wheel over the volume. Long song names scroll by when a new song starts, and when you hover over them.
- **Search:** type a song, artist, playlist or album. Click a song to play it, or open a playlist or album to see its songs.
- **Playlist:** browse any of your playlists, your Liked Songs, or an album from search, and click a song to play it.
- **Lobby** and **Session Playlist:** for [listening lobbies](#listening-lobbies).
- **Notifications:** messages like "User added a song" in a lobby.

</details>

<details>
<summary><b>Moving and resizing panels (Edit Mode)</b></summary>

Press `Ctrl` + `Shift` + `` ` ``. It works much like World of Warcraft's own Edit Mode:

- **Drag** a panel to move it, or drag an edge or corner to resize it. Panels snap neatly to each other and the screen edges. Hold `Alt` while dragging to place them freely.
- **Arrow keys** nudge the selected panel one step at a time.
- **Click** a panel to turn it on or off, make it bigger or smaller, or set how see-through it is, both normally and when you hide the overlay (for example, keep Now Playing faintly visible while everything else disappears).

Press `Esc` or **Done** when you're finished. Your layout saves by itself.

Notifications still pop up while the overlay is hidden. Set the Notifications panel's *Opacity when hidden* to 0% if you'd rather they didn't, or untick *Show this panel* to turn them off.

</details>

<details>
<summary><b>The small Now Playing bar</b></summary>

Hover over Now Playing and click the small arrows in its top-right corner to shrink it to a compact bar with the song and previous, play/pause and next. Click them again to make it full size. It shrinks and grows in place, towards the nearest corner of your screen. You can also switch it with **Compact view** in Edit Mode, and move and resize it there like any other panel.

When you hide the overlay with `Ctrl` + `` ` ``, the compact bar stays on screen faintly and **still works**: pause or skip without bringing everything back. It brightens while your mouse is over it. To hide it completely too, set its *Opacity when hidden* to 0%.

</details>

<details>
<summary><b>Using it with other games</b></summary>

Mercify shows up over World of Warcraft out of the box. To add another game:

1. Click the Mercify icon in the system tray (bottom right of the taskbar) to open **Settings**.
2. Under **Only show over these apps**, press **Pick the app in front**.
3. Within 5 seconds, click into your game. It's added to the list.

To have Mercify always visible, wherever you are, switch **Only show over these apps** off.

</details>

<details>
<summary><b>More than one monitor</b></summary>

When you click over to something on another monitor (a browser, Discord), Mercify stays up over your game, as long as the game is still showing on its own screen. It hides if you minimise or close the game, or put another window in front of it on the same screen. Your shortcuts go back to normal in the other program until you click back into the game.

Untick **Stay up while I use another monitor** in Settings if you'd rather it hid. Settings also shows a line saying why Mercify is showing or hidden right now, handy if it isn't doing what you expect.

</details>

<details>
<summary><b>Settings</b></summary>

Open **Settings** by clicking the tray icon. You can:

- start Mercify with Windows (it then waits quietly in the tray instead of opening Settings),
- open Spotify automatically when Mercify starts, and choose whether its window is tucked into the tray,
- choose which games Mercify shows over,
- start or join a [listening lobby](#listening-lobbies),
- see which version you have and check for [updates](#updates),
- re-run any setup step if something stops working.

</details>

## Listening lobbies

Everyone hears the same song at the same moment, each through their own Spotify. Free accounts work, and everyone needs Mercify.

**Quick start:** open Settings from the tray icon, enter your name under **Listening lobby**, and press **Start a lobby**. Mercify copies a code for you: send it to your friends, and they type it in and press **Join**.

<details>
<summary><b>All the ways to start or join</b></summary>

- **Mercify's window** (you don't need to be in your game): in Settings under **Listening lobby**, enter your name, then **Start a lobby** (you're the **host**, and the code is copied for you), or type a friend's code and press **Join**.
- **The tray:** once you've set your name, right-click the tray icon and choose **Start a listening lobby**. The code is copied for you.
- **The overlay:** open the **Lobby** panel (turn it on in Edit Mode if you can't see it), enter your name and a code (or press the dice for a random one), and press **Join lobby**.

Everyone who enters the same code ends up in the same lobby. If nobody's there yet, you've started it and you're the host. Now Playing shows a small badge while you're in a lobby. Leave from the Lobby panel, Settings or the tray icon.

</details>

<details>
<summary><b>Who controls the music</b></summary>

- **The host** plays, pauses, skips and seeks as normal, and everyone follows along within a second or two.
- **Everyone else listens**, and adds songs to the session playlist. Play, pause and skip are greyed out for listeners, but you can still change your own volume.
- If the host leaves, whoever has been in the lobby longest becomes the new host automatically, and the session playlist carries on.

</details>

<details>
<summary><b>The shared playlist</b></summary>

Every lobby has a shared playlist in the **Session Playlist** panel, which appears while you're in a lobby.

- **Add a song** with the **+** next to any song in search or a playlist. Listeners can also just click a song. Each song shows who added it.
- **Add a whole album or playlist:** open it in the Playlist panel (click an album in search to open it there) and press **Add all**. Its songs go in, in order. The list holds up to 100 songs.
- **Up next** shows what's coming. When a song finishes, the next one plays for everyone. If the list is empty, Spotify carries on as usual.
- **The list is in charge.** While it has songs, it decides what plays next, even if Spotify's crossfade or Automix tries to start the next song early. A song the host picks in Mercify still plays straight away, and the list carries on after it.
- **Played** shows what's already played. Hover over a song and press **+** to add it again.
- **The host** can hover over a song to play it now, move it to the top, or remove it, and the host's **Next** plays the next song from the list. **Listeners** can remove songs they added themselves.

</details>

<details>
<summary><b>Vote to skip</b></summary>

If you're listening, press **Next** on Now Playing (or your Next shortcut), or hover over the **Now** row at the top of the session playlist and click the circle-with-a-line sign. Press it again to take your vote back. Your Next button stays lit while your vote counts, and the count shows how many votes are needed.

Once at least half the lobby has voted, the song is skipped for everyone: 1 of 2, 2 of 3 and 2 of 4 are all enough. The next song from the list plays, or Spotify's own next song if the list is empty.

</details>

<details>
<summary><b>Good to know</b></summary>

- **Random codes are safest.** Short made-up codes like `RAID` are easy for strangers to guess, and anyone who knows a code can join.
- Lobby messages go through free public relay servers, the same kind many apps use for chat. They're **encrypted with your lobby code**, so the relays can't see your name or what you're playing. They're run by third parties and can occasionally be slow or down, so Mercify uses several at once.
- Songs that aren't available in a listener's country, and the host's own local files, can't be played along.

</details>

## Updates

Mercify keeps itself up to date; you don't need to do anything. When you open it, its logo shows for a moment while it checks for a new version, and if there is one, it installs it and opens the new version, like Discord or Steam.

<details>
<summary><b>More about updates</b></summary>

- **When you open it:** if you're offline or GitHub is slow, Mercify just opens as usual. When Mercify starts with Windows, the logo only appears if there's an update to install.
- **While it's running**, it checks a few times a day, downloads any new version quietly, and installs it the next time Mercify closes. You'll get a Windows notification when an update is ready. To update straight away, choose **Restart and update** in Settings or **Restart to update** from the tray icon.
- The **Updates** section in Settings shows which version you have and lets you check for a new one.
- **Upgrading from version 1.2.0 or earlier?** Those versions can't update themselves, so [download and run the newest `Mercify-Setup`](https://github.com/Kain-Mercer/Mercify/releases/latest/download/Mercify-Setup.exe) one last time. Your layout and settings are kept.
- **Portable version?** It can't replace itself while running. Settings tells you when a new version is out and gives you a **Download** button; replace your old file with the new one.

</details>

## Uninstalling

Uninstall Mercify from Windows' **Apps** settings like any other program. It asks whether to also remove the Spotify add-ons it set up:

- **Yes** puts Spotify back to normal. Spotify itself stays installed.
- **No** removes only Mercify's own part and leaves SpotX and Spicetify as they are. Choose this if you used them before Mercify.

Portable version: open Settings and click **Remove Spicetify and SpotX…** under Setup before deleting the file.

## Troubleshooting

First thing to try for almost anything: make sure Mercify is up to date (it updates itself when you open it).

<details>
<summary><b>I can't see the panels in my game</b></summary>

Set your game to **Windowed (Fullscreen)** or **Borderless**, not Fullscreen. Check the game is listed under **Only show over these apps** in Settings (see *Using it with other games* above). And press `Ctrl` + `` ` ``, in case they're just hidden.

</details>

<details>
<summary><b>The panels say "Waiting for Spotify"</b></summary>

Click the message to open Settings. If anything there isn't green, press the big button. If everything is green, make sure Spotify is open; if it is, press **Redo** next to *Mercify extension*. This is most often needed after Spotify updates itself.

</details>

<details>
<summary><b>Windows says "Windows protected your PC"</b></summary>

Click **More info**, then **Run anyway**. Windows shows this for new programs it doesn't know yet.

</details>

<details>
<summary><b>The overlay disappears after I click it, or my game stops taking keys</b></summary>

Right after it happens, right-click the Mercify tray icon, choose **Copy diagnostics**, and paste it into an [issue](https://github.com/Kain-Mercer/Mercify/issues) or a message. It lists which windows Windows put in front and what Mercify did, without any of your other window titles.

</details>

<details>
<summary><b>Clicking an album does nothing, or says it couldn't open it</b></summary>

Albums open in the **Playlist** panel, so make sure that panel is turned on in Edit Mode. Opening albums also needs the newer Mercify extension: open Settings and press **Finish setup** if it's offered (Spotify restarts once).

</details>

<details>
<summary><b>I can't join a lobby ("Couldn't reach any lobby relay")</b></summary>

A firewall, or a school or work network, may be blocking the lobby relays. They use ports 8084, 8884 and 8081. Try another network, such as your phone's hotspot, to check.

</details>

<details>
<summary><b>The panels have a black box behind them</b></summary>

Some graphics drivers cause this. [Open an issue](https://github.com/Kain-Mercer/Mercify/issues) and we'll help you switch on a fix.

</details>

<details>
<summary><b>A shortcut doesn't work</b></summary>

Another program may already be using it. Mercify tells you when it starts if a shortcut couldn't be set up.

</details>

**Something else wrong?** [Open an issue](https://github.com/Kain-Mercer/Mercify/issues) and describe what happened. A screenshot helps a lot. What Mercify changes and sends over the internet is on the **Security** tab above.

## Disclaimer

Mercify is provided **for evaluation purposes only**. It is test software, offered "as is", without warranty of any kind. It may contain bugs, may stop working at any time, and could affect how Spotify behaves on your computer. You use it entirely at your own risk, and the authors accept no responsibility for any loss, damage or account issues that may result.

Mercify is an independent project. It is **not affiliated with, endorsed by or supported by** Spotify, Blizzard Entertainment, the SpotX project or the Spicetify project. All trademarks belong to their respective owners.

Listening lobbies send messages, encrypted with your lobby code, through free public relay servers run by third parties (EMQX, HiveMQ and the Eclipse Mosquitto project). Mercify isn't affiliated with them and can't guarantee they're available.

Mercify relies on third-party tools (SpotX and Spicetify) that modify the Spotify desktop app. Modifying Spotify may go against Spotify's Terms of Use. Please review them and decide for yourself before installing. Mercify doesn't modify, read or inject anything into your games. It simply draws a window on top of them.

---

<sub>Want to build Mercify yourself or help develop it? See the **Contributing** tab and the [developer guide](docs/DEVELOPING.md).</sub>
