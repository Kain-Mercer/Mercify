package com.kainmercer.mercify

import android.content.ComponentName
import android.content.Intent
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap

// Controls the Spotify app on this phone the way the lock screen and Bluetooth controls do:
// through its media session. No Spotify developer app, so no Premium rule and no user cap.
// Reading another app's media session needs notification access (SpotifyListenerService).
class SpotifyModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  companion object {
    const val SPOTIFY = "com.spotify.music"
  }

  private val main = Handler(Looper.getMainLooper())
  private var controller: MediaController? = null
  private var watching = false

  override fun getName() = "MercifySpotify"

  // Runs on the main thread; returns Unit, since React Native methods must return void.
  private fun ui(f: () -> Unit) {
    main.post(f)
  }

  private val sessionManager get() = ctx.getSystemService(MediaSessionManager::class.java)
  private val listener get() = ComponentName(ctx, SpotifyListenerService::class.java)

  private fun hasAccessNow(): Boolean {
    val enabled = Settings.Secure.getString(ctx.contentResolver, "enabled_notification_listeners") ?: return false
    return enabled.split(":").any { ComponentName.unflattenFromString(it)?.packageName == ctx.packageName }
  }

  // ------------------------------------------------------------------ finding Spotify's session

  private val callback = object : MediaController.Callback() {
    override fun onMetadataChanged(metadata: MediaMetadata?) = emitState()
    override fun onPlaybackStateChanged(state: PlaybackState?) = emitState()
    override fun onSessionDestroyed() {
      attach(null)
      emitState()
    }
  }

  private val sessionsChanged = MediaSessionManager.OnActiveSessionsChangedListener { list ->
    attach(list?.firstOrNull { it.packageName == SPOTIFY })
    emitState()
  }

  private fun attach(c: MediaController?) {
    if (c?.sessionToken == controller?.sessionToken) return
    controller?.unregisterCallback(callback)
    controller = c
    c?.registerCallback(callback, main)
  }

  private fun findSpotify(): MediaController? {
    if (!hasAccessNow()) return null
    return try {
      val c = sessionManager.getActiveSessions(listener).firstOrNull { it.packageName == SPOTIFY }
      attach(c)
      c
    } catch (_: SecurityException) {
      null
    }
  }

  // ------------------------------------------------------------------ state, in the shape lobby.js expects

  private fun positionNow(ps: PlaybackState): Long {
    if (ps.state != PlaybackState.STATE_PLAYING) return ps.position
    val since = SystemClock.elapsedRealtime() - ps.lastPositionUpdateTime
    return ps.position + (since * ps.playbackSpeed).toLong()
  }

  private fun stateMap(): WritableMap? {
    val c = controller ?: findSpotify() ?: return null
    val md = c.metadata
    val ps = c.playbackState
    val m = Arguments.createMap()
    m.putString("source", "spotify")
    m.putBoolean("empty", md == null)
    if (md != null) {
      val id = md.getString(MediaMetadata.METADATA_KEY_MEDIA_ID)
      m.putString("uri", if (id != null && id.startsWith("spotify:")) id else null)
      m.putString("mediaId", id)
      m.putString("name", md.getString(MediaMetadata.METADATA_KEY_TITLE))
      val artists = Arguments.createArray()
      (md.getString(MediaMetadata.METADATA_KEY_ARTIST) ?: "").split(", ").filter { it.isNotBlank() }.forEach { artists.pushString(it) }
      m.putArray("artists", artists)
      m.putString("album", md.getString(MediaMetadata.METADATA_KEY_ALBUM))
      m.putDouble("duration", md.getLong(MediaMetadata.METADATA_KEY_DURATION).toDouble())
      val art = md.getString(MediaMetadata.METADATA_KEY_ALBUM_ART_URI) ?: md.getString(MediaMetadata.METADATA_KEY_ART_URI)
      m.putString("image", if (art != null && art.startsWith("https://")) art else null)
    }
    m.putBoolean("isPlaying", ps?.state == PlaybackState.STATE_PLAYING)
    m.putDouble("position", (ps?.let { positionNow(it) } ?: 0L).toDouble())
    m.putDouble("at", System.currentTimeMillis().toDouble())
    m.putDouble("actions", (ps?.actions ?: 0L).toDouble())
    return m
  }

  private fun emitState() {
    if (!ctx.hasActiveReactInstance()) return
    ctx.emitDeviceEvent("MercifySpotifyState", stateMap())
  }

  // ------------------------------------------------------------------ JS API

  @ReactMethod
  fun hasAccess(p: Promise) = p.resolve(hasAccessNow())

  @ReactMethod
  fun openAccessSettings() {
    ctx.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
  }

  @ReactMethod
  fun isInstalled(p: Promise) = p.resolve(ctx.packageManager.getLaunchIntentForPackage(SPOTIFY) != null)

  @ReactMethod
  fun start(p: Promise) {
    main.post {
      if (!watching && hasAccessNow()) {
        try {
          sessionManager.addOnActiveSessionsChangedListener(sessionsChanged, listener, main)
          watching = true
        } catch (_: SecurityException) {}
      }
      findSpotify()
      p.resolve(watching)
      emitState()
    }
  }

  @ReactMethod
  fun getState(p: Promise) = ui { p.resolve(stateMap()) }

  // Diagnostics for the spike: everything Spotify puts in its metadata and which actions it supports.
  @ReactMethod
  fun describe(p: Promise) = ui {
    val c = controller ?: findSpotify()
    if (c == null) {
      p.resolve(null)
      return@ui
    }
    val m = Arguments.createMap()
    val md = c.metadata
    val keys = Arguments.createMap()
    md?.keySet()?.forEach { k ->
      val v = md.getString(k) ?: try { md.getLong(k).toString() } catch (_: Exception) { "(bitmap/other)" }
      keys.putString(k, v)
    }
    m.putMap("metadata", keys)
    val ps = c.playbackState
    m.putDouble("actions", (ps?.actions ?: 0L).toDouble())
    m.putBoolean("canPlayFromUri", ((ps?.actions ?: 0L) and PlaybackState.ACTION_PLAY_FROM_URI) != 0L)
    m.putBoolean("canPlayFromMediaId", ((ps?.actions ?: 0L) and PlaybackState.ACTION_PLAY_FROM_MEDIA_ID) != 0L)
    m.putBoolean("canPlayFromSearch", ((ps?.actions ?: 0L) and PlaybackState.ACTION_PLAY_FROM_SEARCH) != 0L)
    m.putString("package", c.packageName)
    p.resolve(m)
  }

  // Play a spotify: URI. Three ways, so the spike can find out which Spotify accepts:
  //   "uri"     media session playFromUri (stays in Mercify, if Spotify supports it)
  //   "mediaId" media session playFromMediaId
  //   "link"    open the link in the Spotify app, like tapping a shared song (always works, but shows Spotify)
  @ReactMethod
  fun play(uri: String, method: String, p: Promise) = ui {
    if (!Regex("^spotify:(track|episode):[A-Za-z0-9]{1,64}$").matches(uri)) {
      p.reject("bad_uri", "Not a Spotify song: $uri")
      return@ui
    }
    try {
      when (method) {
        "link" -> {
          val i = Intent(Intent.ACTION_VIEW, Uri.parse(uri)).setPackage(SPOTIFY).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          i.putExtra(Intent.EXTRA_REFERRER, Uri.parse("android-app://" + ctx.packageName))
          ctx.startActivity(i)
        }
        "mediaId" -> {
          val c = controller ?: findSpotify() ?: return@ui p.reject("no_session", "Spotify isn't running")
          c.transportControls.playFromMediaId(uri, Bundle())
        }
        else -> {
          val c = controller ?: findSpotify() ?: return@ui p.reject("no_session", "Spotify isn't running")
          c.transportControls.playFromUri(Uri.parse(uri), Bundle())
        }
      }
      p.resolve(true)
    } catch (e: Exception) {
      p.reject("play_failed", e.message, e)
    }
  }

  private fun withController(p: Promise, f: (MediaController.TransportControls) -> Unit) = ui {
    val c = controller ?: findSpotify()
    if (c == null) p.reject("no_session", "Spotify isn't running") else {
      f(c.transportControls)
      p.resolve(true)
    }
  }

  @ReactMethod fun pause(p: Promise) = withController(p) { it.pause() }
  @ReactMethod fun resume(p: Promise) = withController(p) { it.play() }
  @ReactMethod fun seek(ms: Double, p: Promise) = withController(p) { it.seekTo(ms.toLong()) }
  @ReactMethod fun next(p: Promise) = withController(p) { it.skipToNext() }
  @ReactMethod fun previous(p: Promise) = withController(p) { it.skipToPrevious() }

  // Keep Mercify (and the lobby's connection) running with the screen off.
  @ReactMethod
  fun keepAlive(on: Boolean, text: String) {
    val i = Intent(ctx, LobbyService::class.java).putExtra("text", text)
    if (on) ctx.startForegroundService(i) else ctx.stopService(i)
  }

  // Mercify's own settings and friends list (small JSON strings), in the app's private storage.
  private val prefs get() = ctx.getSharedPreferences("mercify", android.content.Context.MODE_PRIVATE)
  @ReactMethod fun getItem(key: String, p: Promise) = p.resolve(prefs.getString(key, null))
  @ReactMethod fun setItem(key: String, value: String?) {
    prefs.edit().apply { if (value == null) remove(key) else putString(key, value) }.apply()
  }

  @ReactMethod fun addListener(eventName: String) {}
  @ReactMethod fun removeListeners(count: Double) {}

  override fun invalidate() {
    controller?.unregisterCallback(callback)
    if (watching) sessionManager.removeOnActiveSessionsChangedListener(sessionsChanged)
    super.invalidate()
  }
}
