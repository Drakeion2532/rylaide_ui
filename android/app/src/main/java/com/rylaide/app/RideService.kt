package com.rylaide.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.os.Looper
import org.json.JSONObject

/**
 * Runs for the whole ride so the phone can live in a pocket:
 *
 * 1. GPS keeps going with the screen off (the WebView pauses its own location when the screen goes off),
 *    and fixes go to the web app, which does navigation, recording and the live map.
 * 2. Watch display: the ride shows on the music screen of almost any smartwatch, cheap ones included.
 *    Their phone apps (NoiseFit, Da Fit, boAt Crest…) send the phone's "now playing" title and artist to the
 *    watch. Rylaide publishes a media session whose three lines are the ride (next turn, road, speed…), and the
 *    watch's music buttons control the ride: play/pause = mute/unmute the mic, next/previous = next page.
 *    Nothing is installed on the watch and its mic and speaker aren't used.
 */
class RideService : Service() {

    companion object {
        const val ACTION_START = "com.rylaide.ride.START"
        const val ACTION_STOP = "com.rylaide.ride.STOP"
        const val EXTRA_WATCH = "watchDisplay"
        private const val CHANNEL = "ride"
        private const val NOTE_ID = 9

        @Volatile var running: RideService? = null; private set
        @Volatile var sink: Sink? = null
    }

    interface Sink {
        fun position(json: JSONObject)
        /** "playpause" | "next" | "previous" from the watch */
        fun watchButton(action: String)
    }

    private var lm: LocationManager? = null
    private var session: MediaSession? = null
    private var lines = arrayOf("Rylaide", "Ride in progress", "")

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) { stop(); return START_NOT_STICKY }
        goForeground()
        running = this
        startGps()
        setWatchDisplay(intent?.getBooleanExtra(EXTRA_WATCH, false) == true)
        return START_NOT_STICKY
    }

    private fun stop() {
        running = null
        stopGps()
        setWatchDisplay(false)
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE) else @Suppress("DEPRECATION") stopForeground(true)
        stopSelf()
    }

    override fun onDestroy() { running = null; stopGps(); session?.release(); session = null; super.onDestroy() }

    // ---------------------------------------------------------------- GPS
    private val listener = object : LocationListener {
        override fun onLocationChanged(l: Location) {
            val j = JSONObject().put("lat", l.latitude).put("lng", l.longitude).put("acc", l.accuracy.toDouble()).put("ts", l.time)
            if (l.hasSpeed()) j.put("speed", l.speed.toDouble())
            if (l.hasBearing()) j.put("heading", l.bearing.toDouble())
            sink?.position(j)
        }
        @Deprecated("Needed below API 29")
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
        override fun onProviderEnabled(provider: String) {}
        override fun onProviderDisabled(provider: String) {}
    }

    @SuppressLint("MissingPermission")
    private fun startGps() {
        if (lm != null || checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) return
        val m = getSystemService(LocationManager::class.java)
        if (!m.isProviderEnabled(LocationManager.GPS_PROVIDER)) return
        m.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, listener, Looper.getMainLooper())
        lm = m
    }

    private fun stopGps() { lm?.removeUpdates(listener); lm = null }

    // ---------------------------------------------------------------- watch display
    fun setWatchDisplay(on: Boolean) {
        if (!on) { session?.let { it.isActive = false; it.release() }; session = null; return }
        if (session != null) return
        session = MediaSession(this, "Rylaide ride").apply {
            setCallback(object : MediaSession.Callback() {
                override fun onPlay() { sink?.watchButton("playpause") }
                override fun onPause() { sink?.watchButton("playpause") }
                override fun onSkipToNext() { sink?.watchButton("next") }
                override fun onSkipToPrevious() { sink?.watchButton("previous") }
            })
            setPlaybackState(PlaybackState.Builder()
                .setActions(PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE or
                    PlaybackState.ACTION_SKIP_TO_NEXT or PlaybackState.ACTION_SKIP_TO_PREVIOUS)
                .setState(PlaybackState.STATE_PLAYING, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1f)
                .build())
            isActive = true
        }
        show(lines[0], lines[1], lines[2])
    }

    /** Three short lines: the watch shows title (big), artist and album (when it has room). */
    fun show(title: String, artist: String, album: String) {
        lines = arrayOf(title, artist, album)
        session?.setMetadata(MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title.take(40))
            .putString(MediaMetadata.METADATA_KEY_ARTIST, artist.take(40))
            .putString(MediaMetadata.METADATA_KEY_ALBUM, album.take(40))
            .build())
    }

    // ---------------------------------------------------------------- notification
    private fun goForeground() {
        val nm = getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Ride in progress", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Keeps GPS and your watch display going while the phone is in your pocket"
                setShowBadge(false)
            })
        }
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE)
        val n = Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Ride in progress")
            .setContentText("GPS stays on with the screen off")
            .setOngoing(true)
            .setContentIntent(open)
            .build()
        val located = checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (Build.VERSION.SDK_INT >= 29 && located) startForeground(NOTE_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        else startForeground(NOTE_ID, n)
    }
}
