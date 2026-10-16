# Mercify for Android (remote)

Control Mercify on your PC from your phone. See what's playing, play/pause/skip, nudge the volume, like a song, and join a listening lobby — all running on the PC. The phone is a remote: it doesn't play Spotify itself, so there's nothing to set up with Spotify on the phone and no Premium needed.

> Earlier test builds tried to drive the phone's own Spotify through notification access. That fought Spotify's foreground and needed Premium for picking songs, so the app is now a remote for the desktop client instead.

## Trying it

1. Download `Mercify-android-<version>.apk` from the newest `android-v...` pre-release on the Releases page and open it. Android asks to allow installing apps from your browser; allow it.
2. On your PC, open **Mercify ▸ Lobby ▸ Phone remote** and tap **Pair a phone**. It shows a QR and a short code.
3. In the Mercify app on your phone, type that code and tap **Pair**. (QR scanning comes later; the code works now.)
4. That's it — the now-playing card and controls drive your PC. Pairing is remembered, and works both at home and away.

## How it's built

React Native. The phone runs the desktop's own `overlay/remote.js` in **device** mode; the PC runs it in **host** mode. One module, one protocol on both sides.

- **Pairing**: the PC shows a one-time code (and a QR of the same). The phone and PC derive a private channel from it — the same X25519 → HKDF → AES-GCM scheme `friends.js` uses — so the link is end-to-end encrypted and nobody else can read it or find it on the relay.
- **Transport**: the free public MQTT relays (`DEFAULT_RELAYS` from `lobby.js`), so it works anywhere with no port-forwarding. A LAN link can be added later with `remote.addLink()` without touching the protocol.
- **Commands**: the phone sends actions (`togglePlay`, `next`, `seek`, `joinLobby`, …); the PC validates each against the bridge's allowlist and the same URI check `lobby.js` uses, then runs it through its own `playerCommand()`. The PC pushes its player / lobby / friends state back on every change.
- `src/remote.js` wires `overlay/remote.js` to the phone's MQTT build (`src/mqtt.js`), the crypto shim (`src/node-crypto.js`, swapped in by `metro.config.js` for files in `overlay/`), and generic key/value storage + a keep-alive notification.
- `src/buffer-fix.js`: Hermes ignores `Symbol.species`, so `buffer`'s `subarray()` returns a plain Uint8Array there; it's patched to stay a Buffer, as in Node.
- If startup fails, the start screen (and a Problems card) shows the error and which step it was on.

The round-trip is tested on the desktop side: `overlay/tools/remote-test.js` pairs a host and a device through a real broker and checks commands, refused actions, state and privacy. CI runs it before every Windows build.

Build: the "Build Android app" workflow (`.github/workflows/android.yml`) on any branch; set `test_release` (e.g. `test.2`) to publish `android-v<version>-test.2` as a pre-release. The version is in `package.json`.

Signing: builds are signed with Mercify's own key from the `ANDROID_KEYSTORE_BASE64` and `ANDROID_KEYSTORE_PASSWORD` repository secrets (alias `mercify`). Kain keeps the keystore; if it's lost, installed copies can't be updated, only reinstalled. Without the secrets, builds fall back to React Native's public debug key.

## Audio to the phone

Tap **Listen on this phone** to hear the PC's sound here. The PC captures its system audio and sends it over WebRTC (`react-native-webrtc`); signalling (SDP + ICE) rides the same encrypted remote channel. NAT traversal uses Google STUN plus, when an Open Relay (metered.ca) key is set on the PC (`config.openRelay = { app, apiKey }`), its free TURN — so it works away from home. Without a key it's STUN-only: same network and friendly NATs.

v1 streams the whole system's audio (pure Electron capture, no native module). Narrowing to just Spotify needs a native WASAPI process-loopback capturer — a later change.

Not done yet: scanning the QR with the camera (the typed code works now), hosting a lobby from the phone, the LAN-direct control link, Spotify-only audio capture, and routing phone audio to the loudspeaker by default (may play through the earpiece until an in-call-manager is added). The old `SpotifyListenerService` / `SpotifyModule` native code is unused by the remote and kept only for its storage + keep-alive helpers; it can be removed in a later cleanup.
