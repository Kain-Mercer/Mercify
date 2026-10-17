package com.kainmercer.mercify

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

// A foreground service while you're in a lobby, so Android keeps Mercify running (and following
// the host) with the screen off or another app in front. It shows the "In a lobby" notification.
class LobbyService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val nm = getSystemService(NotificationManager::class.java)
    nm.createNotificationChannel(NotificationChannel("lobby", "Listening lobby", NotificationManager.IMPORTANCE_LOW))
    val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
    val n = Notification.Builder(this, "lobby")
      .setContentTitle("Mercify")
      .setContentText(intent?.getStringExtra("text") ?: "In a listening lobby")
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentIntent(open)
      .setOngoing(true)
      .build()
    if (Build.VERSION.SDK_INT >= 34) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    else startForeground(1, n)
    return START_NOT_STICKY
  }
}
