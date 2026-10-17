package com.kainmercer.mercify

import android.service.notification.NotificationListenerService

// Exists only so Android can grant "notification access", which is what lets Mercify see and
// control Spotify's media session. It never reads anyone's notifications.
class SpotifyListenerService : NotificationListenerService()
