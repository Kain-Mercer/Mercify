# Mercify for Android (test build)

Join a listening lobby from your phone. Your phone's Spotify follows the host's song, and you can suggest songs, vote to skip and add friends, the same as on the PC.

Free Spotify works: Mercify controls the Spotify app on your phone the way your lock screen does, so it doesn't need Premium. Spotify gives free accounts a daily amount of picking your own songs, though. When that runs out, your phone can't follow the host until the next day.

## Trying it

1. Download `Mercify-android-<version>.apk` from the newest `android-v...` pre-release on the Releases page and open it. Android asks to allow installing apps from your browser; allow it.
2. Open Spotify once and play anything, so Android knows it's there.
3. In Mercify, tap **Allow** next to "Mercify can see and control Spotify" and turn Mercify on in the list that opens (Android calls it Notification access).
4. Pick a name, type the lobby code a PC started, and tap **Join lobby**.

The **Test: how Spotify takes orders** card tries three ways of starting a song. Tell Kain which work:

- **Media session**: Spotify plays the song without leaving Mercify (best, if Spotify allows it).
- **Media ID**: another way of the same.
- **Open link**: Spotify opens the song, like tapping a shared link. It always works, but Spotify comes to the front.

**What does Spotify report?** shows what Spotify tells Android about the song playing. Send Kain a screenshot of it.

Not in this build yet: hosting from the phone, YouTube videos, car mode and Discord.

## How it's built

React Native. The phone runs the desktop's own `overlay/lobby.js` and `overlay/friends.js`, so lobbies and friends are one protocol on both:

- `src/node-crypto.js` is Node's `crypto` (as much as those two files use) on the @noble libraries; `metro.config.js` swaps it in for files in `overlay/`. `src/mqtt.js` is mqtt's React Native build.
- `src/spotify.js` and `android/.../SpotifyModule.kt` control Spotify through its media session (notification access, `SpotifyListenerService`), with the same `command(action, args)` actions as the desktop's `playerCommand()`.
- `LobbyService` keeps Mercify running while you're in a lobby, with a notification.
- `npm test` checks the crypto against Node's byte for byte and runs a phone and a PC in one lobby, through stand-in relays and through a real MQTT broker. CI runs it before every build.

Build: the "Build Android app" workflow (`.github/workflows/android.yml`) on any branch; set `test_release` (e.g. `test.1`) to publish `android-v<version>-test.1` as a pre-release. The version is in `package.json`. Test builds are signed with React Native's public debug key; real releases will need our own key.
