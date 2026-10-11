# Mercify user guide

Everything Mercify can do, in short sections. Click a heading to open it. New here? The [front page](../README.md) is all you need to get going.

**Jump to:** [Setting up](#setting-up) · [The panels](#the-panels) · [Other games and monitors](#other-games-and-monitors) · [Listening lobbies](#listening-lobbies) · [Settings](#settings) · [Updates](#updates) · [Uninstalling](#uninstalling)

---

## Setting up

<details>
<summary><b>What you need</b></summary>

- **Windows 10 or 11.**
- **The Spotify desktop app.** Mercify installs it for you if you don't have it. The Microsoft Store version won't work.
- **Your game in "Windowed (Fullscreen)" or "Borderless" mode.** Mercify can't appear over true fullscreen.

A free Spotify account is fine.

</details>

<details>
<summary><b>What "Set up everything" does</b></summary>

It installs Spotify if you don't have it, plus the two add-ons Mercify needs to talk to Spotify (SpotX and Spicetify). It doesn't ask you anything and takes a few minutes; the bar at the top shows how far along it is.

- At the end Spotify opens. Log in, and the last row, **Connected to Spotify**, turns green by itself. If Spotify's window doesn't show, press **Open Spotify** on that row.
- If something goes wrong, Settings says what in plain words, with a **Try again** button. **Copy details** copies the full log to send to whoever gave you Mercify.

From then on, opening Mercify also opens Spotify and tucks Spotify's window into the tray, since Mercify's panels do its job. To get Spotify's window back, right-click the Mercify tray icon and choose **Show Spotify window**.

</details>

<details>
<summary><b>The portable version</b></summary>

`Mercify-portable` runs straight from the file without installing. It starts a little slower and can't update itself: Settings tells you when there's a new version and gives you a **Download** button.

</details>

## The panels

<details>
<summary><b>Moving and resizing panels (Edit Mode)</b></summary>

Press `Ctrl` + `Shift` + `` ` `` to enter Edit Mode. It works like World of Warcraft's Edit Mode:

- **Drag** a panel to move it, or drag an edge or corner to resize it. Panels snap neatly to each other and the screen edges; hold `Alt` to place freely.
- **Arrow keys** nudge the selected panel.
- **Click** a panel to turn it on or off, make it bigger or smaller, or set how see-through it is, both normally and while Mercify is hidden.

Press `Esc` or **Done** when you're finished. Your layout saves by itself.

Lobby notifications ("Kain added a song") have their own **Notifications** panel you can move too. Set its *Opacity when hidden* to 0% to stop them popping up while Mercify is hidden.

</details>

<details>
<summary><b>The small Now Playing bar</b></summary>

Click the small arrows at the top right of Now Playing to shrink it to a compact bar with previous, play/pause and next. Click them again to make it full size.

When you hide Mercify with `Ctrl` + `` ` ``, the compact bar can stay on screen faintly and **still works**, so you can pause or skip without bringing everything back. Set its *Opacity when hidden* to 0% in Edit Mode to hide it too.

</details>

<details>
<summary><b>Will clicking a panel interrupt my game?</b></summary>

No. Clicking Mercify's buttons gives the keyboard straight back to your game, so you can keep moving after skipping a song. Only typing in a search box keeps the keyboard, until you press `Enter` or `Esc`, or pick a song.

</details>

## Other games and monitors

<details>
<summary><b>Using Mercify with another game</b></summary>

1. Click the Mercify icon in the tray (bottom right of the taskbar) to open **Settings**.
2. Under **Only show over these apps**, press **Pick the app in front**.
3. Within 5 seconds, click into your game. It's added to the list.

To have Mercify always visible, wherever you are, switch **Only show over these apps** off.

</details>

<details>
<summary><b>More than one monitor</b></summary>

If you click over to something on another monitor (a browser, Discord), Mercify stays up over your game as long as the game is still showing on its own screen. It hides if you minimise or close the game, or cover it on the same screen. Untick **Stay up while I use another monitor** in Settings to change this.

Settings also shows a line saying why Mercify is showing or hidden right now, handy if it isn't doing what you expect.

</details>

## Listening lobbies

Listen along with friends: the same song at the same moment, each through your own Spotify. Free accounts work, and everyone needs Mercify.

<details>
<summary><b>Start or join a lobby</b></summary>

**From Mercify's window** (no need to be in your game): open Settings from the tray icon, enter **your name** under **Listening lobby**, and press **Start a lobby**. Mercify makes a code, makes you the **host** and copies the code so you can paste it to your friends. To join a friend's lobby, type their code in the box and press **Join**.

**From the tray:** once you've set your name, right-click the tray icon and choose **Start a listening lobby**. The code is copied for you.

**From the overlay:** open the **Lobby** panel (turn it on in Edit Mode if you can't see it), enter your name and a code (or press the dice for a random one), and press **Join lobby**.

Everyone with the same code ends up together. Whoever's first is the host. Leave from the Lobby panel, Settings or the tray icon.

</details>

<details>
<summary><b>Who controls the music</b></summary>

- **The host** plays, pauses, skips and seeks as normal, and everyone follows within a second or two.
- **Everyone else listens** and adds songs to the shared playlist. You can still change your own volume.
- If the host leaves, whoever has been there longest takes over, and the playlist carries on.

</details>

<details>
<summary><b>The shared playlist</b></summary>

Every lobby has a **Session Playlist** panel that everyone sees.

- **Add a song** with the **+** next to it in search or a playlist. Listeners can also just click a song.
- **Add a whole album or playlist:** open it in the Playlist panel and press **Add all**. Up to 100 songs fit.
- When a song ends, the next one from the list plays for everyone. While the list has songs, it decides what plays next. If it's empty, Spotify carries on as usual.
- **The host** can play a song now, move it to the top or remove it. **Listeners** can remove their own songs.

</details>

<details>
<summary><b>Vote to skip</b></summary>

As a listener, press **Next** (or your Next shortcut) to vote to skip the current song; press it again to take your vote back. Once at least half the lobby votes, it's skipped for everyone: 1 of 2, 2 of 3 and 2 of 4 are all enough.

</details>

<details>
<summary><b>Good to know</b></summary>

- **Use random codes.** Short codes like `RAID` are easy for strangers to guess, and anyone with the code can join.
- Lobby messages go through free public relay servers, **encrypted with your lobby code**, so the relays can't see your name or what you're playing. They can occasionally be slow; Mercify uses several at once.
- Songs not available in a listener's country, and the host's local files, can't be played along.

</details>

## Settings

<details>
<summary><b>What you can change</b></summary>

Open **Settings** from the tray icon to:

- start Mercify with Windows (it then waits quietly in the tray),
- open Spotify automatically, and choose whether its window is tucked into the tray,
- choose which games Mercify shows over,
- see your shortcuts,
- start or join a lobby,
- re-run any setup step if something stops working.

</details>

## Updates

<details>
<summary><b>How Mercify updates</b></summary>

- **When you open it**, Mercify shows its logo while it checks for a new version. If there is one, it downloads and installs it right there, then opens the new version, like Discord or Steam. Offline or GitHub slow? It just opens as usual. When it starts with Windows, the logo only appears if there's an update.
- **While it's running**, it checks a few times a day, downloads quietly, and installs when Mercify closes. To update straight away, choose **Restart and update** in Settings or **Restart to update** in the tray.

**Coming from version 1.2.0 or older?** Download and run the newest `Mercify-Setup` from the [Releases page](https://github.com/Kain-Mercer/Mercify/releases) once. Your settings are kept, and it updates itself from then on.

</details>

## Uninstalling

<details>
<summary><b>Removing Mercify</b></summary>

Uninstall it from Windows' **Apps** settings like any other program. It asks whether to also remove the Spotify add-ons it set up:

- **Yes** puts Spotify back to normal. Spotify itself stays installed.
- **No** removes only Mercify's part. Choose this if you used SpotX or Spicetify before Mercify.

Portable version: open Settings and click **Remove Spicetify and SpotX…** under Setup before deleting the file.

</details>

---

Stuck? See [Help with problems](TROUBLESHOOTING.md), or [open an issue](https://github.com/Kain-Mercer/Mercify/issues).
