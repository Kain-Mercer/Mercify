package com.kainmercer.mercify

import android.app.Application
import android.media.AudioAttributes
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.oney.WebRTCModule.WebRTCModuleOptions
import org.webrtc.audio.JavaAudioDeviceModule

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          add(MercifyPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    // The PC's audio is music, not a phone call. By default WebRTC plays incoming audio as a call
    // (earpiece, Bluetooth only as low-quality SCO). Marking it as media makes Android route it
    // like any music app: loudspeaker, wired headphones, or a Bluetooth speaker over A2DP, with
    // the media volume. Must be set before WebRTCModule initialises.
    WebRTCModuleOptions.getInstance().audioDeviceModule =
      JavaAudioDeviceModule.builder(this)
        .setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
            .build()
        )
        .createAudioDeviceModule()
    loadReactNative(this)
  }
}
