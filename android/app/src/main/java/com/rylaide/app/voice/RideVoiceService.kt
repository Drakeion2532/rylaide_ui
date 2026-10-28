package com.rylaide.app.voice

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import com.rylaide.app.MainActivity
import com.rylaide.app.R
import org.json.JSONObject

/**
 * Keeps group voice running for the whole ride, including with the screen off or the phone in a pocket:
 * a foreground service with a "Group voice on · Mute" notification. The web app starts and stops it.
 */
class RideVoiceService : Service() {

    companion object {
        const val ACTION_START = "com.rylaide.voice.START"
        const val ACTION_MUTE = "com.rylaide.voice.MUTE"
        const val ACTION_STOP = "com.rylaide.voice.STOP"
        const val EXTRA_CONFIG = "config"
        private const val CHANNEL = "ride_voice"
        private const val NOTE_ID = 7

        /** The running hub, for the web bridge. Null when voice is off or the phone is older than Android 10. */
        @Volatile var hub: VoiceHub? = null; private set
        /** Set by MainActivity: where packets for the server and UI state go (the WebView). */
        @Volatile var sink: Sink? = null

        fun supported() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q

        fun meshPermissions(): Array<String> = if (Build.VERSION.SDK_INT >= 31)
            arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_ADVERTISE)
        else arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)

        fun granted(ctx: Context, vararg perms: String) = perms.all { ctx.checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }
    }

    interface Sink {
        fun toServer(packet: ByteArray)
        fun state(json: JSONObject)
    }

    private var groupName = ""

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!supported()) { stopSelf(); return START_NOT_STICKY }
        when (intent?.action) {
            ACTION_STOP -> { stopVoice(); return START_NOT_STICKY }
            ACTION_MUTE -> {
                hub?.let { it.setMuted(!it.muted); notifyState() }
                return START_NOT_STICKY
            }
            else -> {
                val cfg = runCatching { JSONObject(intent?.getStringExtra(EXTRA_CONFIG) ?: "{}") }.getOrElse { JSONObject() }
                groupName = cfg.optString("groupName", groupName)
                goForeground()
                val h = hub ?: VoiceHub(this, { p -> sink?.toServer(p) }, { s -> sink?.state(s) }).also { hub = it }
                h.start(
                    userId = cfg.optString("userId"), groupId = cfg.optString("groupId"),
                    muted = cfg.optBoolean("muted", false), noiseCancel = cfg.optBoolean("noiseCancel", true),
                    sensitivity = cfg.optString("sensitivity", "normal"), online = cfg.optBoolean("online", true),
                    meshAllowed = granted(this, *meshPermissions()),
                )
                notifyState()
            }
        }
        return START_NOT_STICKY
    }

    private fun stopVoice() {
        hub?.stop(); hub = null
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE) else @Suppress("DEPRECATION") stopForeground(true)
        stopSelf()
    }

    override fun onDestroy() { hub?.stop(); hub = null; super.onDestroy() }

    // ---------------------------------------------------------------- notification
    private fun goForeground() {
        val nm = getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Group voice", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Shown while you're talking with your group on a ride"
                setShowBadge(false)
            })
        }
        var type = 0
        if (Build.VERSION.SDK_INT >= 30 && granted(this, Manifest.permission.RECORD_AUDIO)) type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        if (granted(this, *meshPermissions())) type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
        if (type != 0) startForeground(NOTE_ID, note(), type) else startForeground(NOTE_ID, note())
    }

    private fun notifyState() = getSystemService(NotificationManager::class.java).notify(NOTE_ID, note())

    private fun note(): Notification {
        val muted = hub?.muted == true
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE)
        val mute = PendingIntent.getService(this, 1, Intent(this, RideVoiceService::class.java).setAction(ACTION_MUTE), PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(if (muted) "Group voice · muted" else "Group voice on")
            .setContentText(if (groupName.isNotBlank()) groupName else "Talking with your group")
            .setOngoing(true)
            .setContentIntent(open)
            .addAction(Notification.Action.Builder(null, if (muted) "Unmute" else "Mute", mute).build())
            .build()
    }
}
