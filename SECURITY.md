# Privacy and safety

What Mercify changes on your computer, and what it sends where. In short: no accounts, no tracking, nothing about you leaves your PC except what's listed here.

## What Mercify changes

- **Spotify:** to talk to Spotify, Mercify installs two well-known community add-ons, **SpotX** and **Spicetify**, plus its own small Spotify extension. Uninstalling Mercify offers to put Spotify back to normal. These add-ons change the Spotify app, which may go against Spotify's Terms of Use, so please decide for yourself.
- **Your games:** nothing. Mercify doesn't read, change or inject anything into any game. It only draws a see-through window on top.

## What goes over the internet

| What | Where to | Why |
|---|---|---|
| Update checks and downloads | GitHub (this project's Releases) | Keeping Mercify up to date |
| Setup downloads | GitHub (SpotX and Spicetify's official releases) | Only when you press **Set up everything** or **Redo** |
| Listening lobby messages | Free public relay servers (EMQX, HiveMQ, Eclipse Mosquitto) | Only while you're in a lobby |

Lobby messages are **encrypted with your lobby code**, so the relays can't see your name or what you're playing. Anyone who knows the code can join, so use the random codes Mercify makes.

Mercify doesn't collect statistics, crash reports or anything else about you. **Copy diagnostics** in the tray menu only copies to your clipboard; nothing is sent unless you paste it somewhere yourself.

## Updates are checked

Mercify isn't code-signed yet (that's why Windows shows "Windows protected your PC" the first time). Each update is downloaded from GitHub over HTTPS and checked against a fingerprint (SHA-512) published with the release before it's installed, so a damaged or incomplete download is refused.

## Found a security problem?

Please don't post the details publicly. [Open an issue](https://github.com/Kain-Mercer/Mercify/issues) saying you've found a security problem (without the details), and we'll arrange a private way to talk.
