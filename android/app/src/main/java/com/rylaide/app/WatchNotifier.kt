// Copyright (c) 2026 Shubhan Punde · https://github.com/Drakeion2532/rylaide_ui · All rights reserved · sp2532-ce395384fbda
package com.rylaide.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build

/**
 * Ride info on the rider's smartwatch, through the phone's notifications.
 *
 * Budget watches (Noise, Fire-Boltt, boAt, Amazfit and others) can't run other apps, but their phone app
 * (NoiseFit, Da Fit, boAt Crest…) copies the phone's notifications to the watch. So each turn, arrival,
 * break and group SOS is posted as a short notification and shows up on any such watch, and on Wear OS
 * watches too. Nothing about the watch's mic or speaker is used.
 *
 * Each update is a NEW notification (the previous one is removed): many watch apps only forward a
 * notification when it first appears and ignore later edits to it.
 */
class WatchNotifier(private val context: Context) {

    companion object {
        private const val CHANNEL = "ride_watch"
        private const val CHANNEL_ALERT = "ride_watch_alert"
        private const val FIRST_ID = 100
        private const val IDS = 50
    }

    private val nm = context.getSystemService(NotificationManager::class.java)
    private var current = -1
    private var next = FIRST_ID

    init {
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Turns and ride info for your watch", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "Shows the next turn, arrival and breaks on a smartwatch that shows your phone’s notifications"
                setSound(null, null)          // the phone stays quiet; the watch buzzes on its own
                enableVibration(false)
                setShowBadge(false)
            })
        }
        if (nm.getNotificationChannel(CHANNEL_ALERT) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL_ALERT, "SOS and crash alerts for your watch", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "A rider in your group needs help"
                setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM), AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build())
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 400, 150, 400, 150, 800)
            })
        }
    }

    fun canPost(): Boolean = nm.areNotificationsEnabled()

    /** kind: "nav" (turns, arrival, breaks) or "sos" (a rider needs help, crash countdown). */
    fun post(title: String, text: String, kind: String) {
        val sos = kind == "sos"
        val open = PendingIntent.getActivity(context, 0, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE)
        val n = Notification.Builder(context, if (sos) CHANNEL_ALERT else CHANNEL)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title.take(60))
            .setContentText(text.take(120))
            .setStyle(Notification.BigTextStyle().bigText(text.take(240)))
            .setCategory(if (sos) Notification.CATEGORY_ALARM else Notification.CATEGORY_NAVIGATION)
            .setAutoCancel(true)
            .setTimeoutAfter(if (sos) 30 * 60_000L else 10 * 60_000L)
            .setContentIntent(open)
            .build()
        if (current >= 0) nm.cancel(current)
        current = next
        next = FIRST_ID + (next - FIRST_ID + 1) % IDS
        nm.notify(current, n)
    }

    fun clear() { if (current >= 0) nm.cancel(current); current = -1 }

    /** Android 13+ asks before an app can post notifications. */
    fun needsPermission(): Boolean = Build.VERSION.SDK_INT >= 33 &&
        context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED
}
