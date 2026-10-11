<p align="center"><img src="docs/logo.png" width="240" alt="Mercify" /></p>

<p align="center"><b>Your Spotify, right inside your game.</b><br/>Skip songs, search and pick playlists without ever alt-tabbing.</p>

<p align="center"><a href="https://github.com/Kain-Mercer/Mercify/releases/latest"><b>⬇ Download Mercify</b></a> · <a href="docs/GUIDE.md">User guide</a> · <a href="docs/TROUBLESHOOTING.md">Help</a></p>

> **Early test version.** It works, but expect the odd bug. See the [disclaimer](#disclaimer).

## What you get

- 🎵 **Now Playing:** the song, album art, and play, skip, volume and like buttons, floating over your game.
- 🔍 **Search:** find any song, artist, album or playlist and play it.
- 📂 **Your playlists:** browse them and pick a song.
- 👥 **Listening lobbies:** listen to the same music at the same time as your friends.

It only shows up while your game is in front (World of Warcraft out of the box), and works with a **free** Spotify account.

## Get started

1. [**Download `Mercify-Setup`**](https://github.com/Kain-Mercer/Mercify/releases/latest) and run it.
   *If Windows says "Windows protected your PC", click **More info**, then **Run anyway**. It says that because Mercify is new.*
2. Press the big green **Set up everything** button and wait a few minutes. It sets up Spotify for you.
3. Log in to Spotify when it opens.
4. Start your game, set to **Windowed (Fullscreen)** or **Borderless**. Your music panels appear on top.

That's it. Mercify keeps itself up to date.

## The three shortcuts

| Press | To |
|---|---|
| `Ctrl` + `` ` `` | Show or hide Mercify (`` ` `` is the key under `Esc`) |
| `Ctrl` + `Shift` + `` ` `` | Move and resize the panels |
| `Ctrl` + `Shift` + `Space` | Jump to search, type, press `Enter` to play |

## Listen with friends

Open Mercify's window from the tray icon, enter your name and press **Start a lobby**. Mercify copies a code for you: send it to your friends, and they type it in and press **Join**. Everyone hears the same song at the same moment, and anyone can add songs to the shared playlist.

## Need more?

- 📖 [**User guide**](docs/GUIDE.md): moving panels, other games, lobbies in detail, settings, updates, uninstalling.
- 🛠️ [**Help with problems**](docs/TROUBLESHOOTING.md): the usual fixes, in one page.
- 🔒 [**Privacy and safety**](SECURITY.md): what Mercify changes and what it sends where.
- 🐞 [**Report a problem**](https://github.com/Kain-Mercer/Mercify/issues): tell us what happened (a screenshot helps).

## Disclaimer

Mercify is test software, provided "as is" with no warranty, and you use it at your own risk. It isn't made by or connected to Spotify, Blizzard, SpotX or Spicetify. It uses SpotX and Spicetify, which modify the Spotify app, and that may go against Spotify's Terms of Use, so please decide for yourself. Mercify never touches your games: it just draws a window on top of them.

<details>
<summary>Full disclaimer</summary>

Mercify is provided **for evaluation purposes only**. It is test software, offered "as is", without warranty of any kind. It may contain bugs, may stop working at any time, and could affect how Spotify behaves on your computer. You use it entirely at your own risk, and the authors accept no responsibility for any loss, damage or account issues that may result.

Mercify is an independent project. It is **not affiliated with, endorsed by or supported by** Spotify, Blizzard Entertainment, the SpotX project or the Spicetify project. All trademarks belong to their respective owners.

Listening lobbies send messages, encrypted with your lobby code, through free public relay servers run by third parties (EMQX, HiveMQ and the Eclipse Mosquitto project). Mercify isn't affiliated with them and can't guarantee they're available.

Mercify relies on third-party tools (SpotX and Spicetify) that modify the Spotify desktop app. Modifying Spotify may go against Spotify's Terms of Use. Please review them and decide for yourself before installing. Mercify doesn't modify, read or inject anything into your games. It simply draws a window on top of them.

</details>
