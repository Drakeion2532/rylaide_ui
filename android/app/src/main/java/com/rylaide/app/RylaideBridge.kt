package com.rylaide.app

import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.speech.tts.TextToSpeech
import android.webkit.JavascriptInterface
import android.util.Base64
import com.rylaide.app.voice.RideVoiceService
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

/**
 * window.RylaideAndroid in the web app. Every method is called from the WebView's JS thread,
 * so anything touching views hops to the UI thread.
 */
class RylaideBridge(private val activity: MainActivity) {

    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private val queued = mutableListOf<String>()

    init {
        tts = TextToSpeech(activity) { status ->
            ttsReady = status == TextToSpeech.SUCCESS
            tts?.let { t ->
                if (ttsReady) {
                    val india = Locale("en", "IN")
                    if (t.isLanguageAvailable(india) >= TextToSpeech.LANG_AVAILABLE) t.language = india
                    t.setAudioAttributes(
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build()
                    )
                    synchronized(queued) { queued.forEach { say(it) }; queued.clear() }
                }
            }
        }
    }

    private fun say(text: String) {
        tts?.speak(text, TextToSpeech.QUEUE_ADD, null, "rylaide-${System.nanoTime()}")
    }

    /** Turn-by-turn and group announcements, through the navigation audio stream (ducks music). */
    @JavascriptInterface
    fun speak(text: String?) {
        if (text.isNullOrBlank()) return
        if (ttsReady) say(text) else synchronized(queued) { queued.add(text) }
    }

    /** Pattern as a JSON array of milliseconds, like navigator.vibrate: [on, off, on, …]. */
    @JavascriptInterface
    fun vibrate(pattern: String?) {
        val arr = try { JSONArray(pattern ?: "[]") } catch (e: Exception) { JSONArray().put(pattern?.toLongOrNull() ?: 0) }
        if (arr.length() == 0) return
        val timings = LongArray(arr.length() + 1) { i -> if (i == 0) 0L else arr.optLong(i - 1).coerceIn(0, 5000) }
        val vib: Vibrator = if (Build.VERSION.SDK_INT >= 31)
            (activity.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
        else @Suppress("DEPRECATION") (activity.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator)
        if (!vib.hasVibrator()) return
        vib.vibrate(VibrationEffect.createWaveform(timings, -1))
    }

    /** Android share sheet (WhatsApp, Messages…) for invites and ride summaries. */
    @JavascriptInterface
    fun share(title: String?, text: String?) {
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_SUBJECT, title ?: "Rylaide")
            putExtra(Intent.EXTRA_TEXT, text ?: "")
        }
        activity.runOnUiThread { activity.startActivity(Intent.createChooser(send, title ?: "Share")) }
    }

    /** Keep the screen on while a ride is running. */
    @JavascriptInterface
    fun keepAwake(on: Boolean) = activity.keepAwake(on)

    /** Settings → App server. */
    @JavascriptInterface
    fun openServerSettings() = activity.showSetup(null)

    @JavascriptInterface
    fun serverUrl(): String = activity.serverUrl

    @JavascriptInterface
    fun version(): String = BuildConfig.VERSION_NAME

    // ---------------------------------------------------------------- group voice
    // The web app drives it (engine.js syncVoice); the phone does the audio, Bluetooth and screen-off running.

    /** True on Android 10+, where the phone's own voice engine and offline voice work. Older phones use the web engine. */
    @JavascriptInterface
    fun voiceSupported(): Boolean = RideVoiceService.supported()

    /** {userId, groupId, groupName, muted, noiseCancel, sensitivity, online} */
    @JavascriptInterface
    fun voiceStart(config: String?) { if (RideVoiceService.supported()) activity.startVoice(config ?: "{}") }

    @JavascriptInterface
    fun voiceStop() = activity.stopVoice()

    @JavascriptInterface
    fun voiceMute(muted: Boolean) { RideVoiceService.hub?.setMuted(muted) }

    /** A live voice packet from the server (base64). */
    @JavascriptInterface
    fun voiceIn(b64: String?) {
        val hub = RideVoiceService.hub ?: return
        val bytes = try { Base64.decode(b64 ?: return, Base64.NO_WRAP) } catch (e: IllegalArgumentException) { return }
        hub.fromServer(bytes)
    }

    /** {noiseCancel?, sensitivity?, online?} */
    @JavascriptInterface
    fun voiceConfig(json: String?) {
        val hub = RideVoiceService.hub ?: return
        val c = try { JSONObject(json ?: "{}") } catch (e: Exception) { return }
        if (c.has("noiseCancel")) hub.setNoiseCancel(c.optBoolean("noiseCancel"))
        if (c.has("sensitivity")) hub.setSensitivity(c.optString("sensitivity"))
        if (c.has("online")) hub.setOnline(c.optBoolean("online"))
    }

    fun shutdown() {
        tts?.stop()
        tts?.shutdown()
        tts = null
    }
}
