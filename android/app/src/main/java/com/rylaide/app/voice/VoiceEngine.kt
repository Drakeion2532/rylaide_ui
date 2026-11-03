// Copyright (c) 2026 Shubhan Punde · https://github.com/Drakeion2532/rylaide_ui · All rights reserved · sp2532-ce395384fbda
package com.rylaide.app.voice

import android.annotation.SuppressLint
import android.annotation.TargetApi
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.AutomaticGainControl
import android.media.audiofx.NoiseSuppressor
import android.os.Build
import android.os.Process
import java.util.ArrayDeque
import java.util.concurrent.Executors

/**
 * Hands-free group voice on the phone: the mic is open for the whole group ride and only what you say is sent
 * (a voice detector skips silence, wind and engine noise between sentences). One switch mutes it.
 *
 *  mic (VOICE_COMMUNICATION: the phone's echo cancel + noise suppression, through the helmet headset)
 *   → 150 Hz rumble filter → voice detector (100 ms pre-roll so the first word isn't clipped)
 *   → Opus 24 kbps, 20 ms → [Listener.onOutgoing] → server and nearby phones
 *  packets from anyone → Opus decoder per rider → 60 ms jitter buffer → mixed (riders can overlap) → headset
 */
@TargetApi(Build.VERSION_CODES.Q)
class VoiceEngine(private val context: Context, private val listener: Listener) {

    companion object {
        private val WATCH_NAME = Regex("watch|\\bband\\b|fitbit|amazfit|galaxy fit|wear ?os|gear s|noisefit|fire-boltt|boat wave")
    }

    interface Listener {
        /** Your own voice, ready to send (ttl/flags are set by the caller per link). */
        fun onOutgoing(packet: Rvp)
        /** talking = you; speakers = sender hashes being heard; mic = "live" | "muted" | "error". */
        fun onState(talking: Boolean, speakers: List<Long>, mic: String, error: String?)
    }

    private val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    @Volatile private var running = false
    @Volatile var muted = false; private set
    @Volatile private var noiseCancel = true
    private var sender = 0L
    private var group = 0L
    private val vad = VoiceDetector()

    // ---------------------------------------------------------------- lifecycle
    fun start(sender: Long, group: Long, muted: Boolean, noiseCancel: Boolean, sensitivity: String, speaker: Boolean = false) {
        this.sender = sender; this.group = group
        this.speaker = speaker
        if (running) route()
        this.noiseCancel = noiseCancel
        vad.setSensitivity(sensitivity)
        if (!running) {
            running = true
            routeToHeadset(true)
            playThread = Thread(::playLoop, "rylaide-voice-play").also { it.start() }
        }
        setMuted(muted)
    }

    fun stop() {
        running = false
        stopCapture()
        playThread?.join(500); playThread = null
        synchronized(riders) { riders.values.forEach { it.decoder.release() }; riders.clear() }
        routeToHeadset(false)
    }

    fun setMuted(m: Boolean) {
        muted = m
        if (!running) return
        if (m) stopCapture() else startCapture()
        report(force = true)
    }

    fun setNoiseCancel(on: Boolean) { noiseCancel = on; effects.forEach { runCatching { it.enabled = on } } }
    fun setSensitivity(s: String) = vad.setSensitivity(s)

    // ---------------------------------------------------------------- where the sound goes
    // Headset (default): wired earphones → Bluetooth helmet headset → phone speaker as a last resort.
    // Phone speaker (car rides): the phone's speaker and the phone's own mic.
    // A smartwatch is never used, for sound or for the mic, even when it's connected for calls.
    @Volatile private var speaker = false
    private val deviceWatcher = object : android.media.AudioDeviceCallback() {
        override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>) { if (running) route() }
        override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>) { if (running) route() }
    }

    fun setSpeaker(on: Boolean) { speaker = on; if (running) route() }

    private fun routeToHeadset(on: Boolean) {
        if (!on) {
            runCatching { audio.unregisterAudioDeviceCallback(deviceWatcher) }
            if (Build.VERSION.SDK_INT >= 31) audio.clearCommunicationDevice()
            else @Suppress("DEPRECATION") { runCatching { audio.stopBluetoothSco() }; audio.isBluetoothScoOn = false; audio.isSpeakerphoneOn = false }
            audio.mode = AudioManager.MODE_NORMAL
            return
        }
        audio.mode = AudioManager.MODE_IN_COMMUNICATION
        audio.registerAudioDeviceCallback(deviceWatcher, android.os.Handler(android.os.Looper.getMainLooper())) // a headset connected mid-ride
        route()
    }

    /** Re-picks the output (and with it the mic) for the current choice and connected devices. */
    private fun route() {
        val wired = listOf(AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES, AudioDeviceInfo.TYPE_USB_HEADSET)
        if (Build.VERSION.SDK_INT >= 31) {
            val devices = audio.availableCommunicationDevices.filter { !isWatch(it) }
            val builtIn = devices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
            val pick = if (speaker) builtIn else
                devices.firstOrNull { it.type in wired }
                    ?: devices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BLE_HEADSET }
                    ?: devices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }
                    ?: builtIn
            if (pick != null) audio.setCommunicationDevice(pick)
            return
        }
        @Suppress("DEPRECATION") run {
            val outs = audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
            val hasWired = outs.any { it.type in wired }
            val headset = outs.any { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO && !isWatch(it) }
            when {
                speaker || (!hasWired && !headset) -> { runCatching { audio.stopBluetoothSco() }; audio.isBluetoothScoOn = false; audio.isSpeakerphoneOn = true }
                hasWired -> { runCatching { audio.stopBluetoothSco() }; audio.isBluetoothScoOn = false; audio.isSpeakerphoneOn = false }
                else -> { audio.isSpeakerphoneOn = false; runCatching { audio.startBluetoothSco() }; audio.isBluetoothScoOn = true }
            }
        }
    }

    /** Smartwatches and fitness bands: by Bluetooth device class, or by name when the class isn't readable. */
    private fun isWatch(d: AudioDeviceInfo): Boolean {
        val name = d.productName?.toString()?.lowercase() ?: ""
        if (WATCH_NAME.containsMatchIn(name)) return true
        val bluetooth = d.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || d.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP ||
            (Build.VERSION.SDK_INT >= 31 && d.type == AudioDeviceInfo.TYPE_BLE_HEADSET)
        if (!bluetooth || Build.VERSION.SDK_INT < 28 || d.address.isNullOrBlank()) return false
        return try {
            val bt = (context.getSystemService(Context.BLUETOOTH_SERVICE) as android.bluetooth.BluetoothManager).adapter
            bt?.getRemoteDevice(d.address)?.bluetoothClass?.majorDeviceClass == android.bluetooth.BluetoothClass.Device.Major.WEARABLE
        } catch (e: Exception) { false } // no Nearby devices permission: the name check above still applies
    }

    // ---------------------------------------------------------------- capture
    private var captureThread: Thread? = null
    @Volatile private var capturing = false
    private var record: AudioRecord? = null
    private val effects = mutableListOf<android.media.audiofx.AudioEffect>()
    @Volatile private var talking = false
    private var error: String? = null

    @SuppressLint("MissingPermission")
    private fun startCapture() {
        if (capturing) return
        val min = AudioRecord.getMinBufferSize(OpusSpec.RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val rec = try {
            AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, OpusSpec.RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(min, OpusSpec.FRAME * 2 * 4))
        } catch (e: SecurityException) { error = "Allow the microphone for Rylaide to talk to your group."; report(true); return }
        if (rec.state != AudioRecord.STATE_INITIALIZED) { rec.release(); error = "Couldn’t start the microphone."; report(true); return }
        error = null
        record = rec
        effects.clear()
        if (NoiseSuppressor.isAvailable()) NoiseSuppressor.create(rec.audioSessionId)?.let { it.enabled = noiseCancel; effects += it }
        if (AcousticEchoCanceler.isAvailable()) AcousticEchoCanceler.create(rec.audioSessionId)?.let { it.enabled = true; effects += it }
        if (AutomaticGainControl.isAvailable()) AutomaticGainControl.create(rec.audioSessionId)?.let { it.enabled = true; effects += it }
        capturing = true
        captureThread = Thread(::captureLoop, "rylaide-voice-mic").also { it.start() }
    }

    private fun stopCapture() {
        capturing = false
        captureThread?.join(400); captureThread = null
        effects.forEach { runCatching { it.release() } }; effects.clear()
        record?.let { runCatching { it.stop() }; it.release() }
        record = null
        if (talking) { talking = false; report(true) }
    }

    private fun captureLoop() {
        Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
        val rec = record ?: return
        val encoder = runCatching { OpusEncoder() }.getOrElse { error = "Opus isn’t available on this phone."; report(true); return }
        val frame = ShortArray(OpusSpec.FRAME)
        val preroll = ArrayDeque<ShortArray>()
        var seq = (Math.random() * 65536).toInt()
        var spurt = 0
        // one-pole high-pass at 150 Hz: wind and engine rumble
        val a = 1.0 / (1.0 + 2 * Math.PI * 150 / OpusSpec.RATE)
        var px = 0.0; var py = 0.0
        fun send(kind: Int, payload: ByteArray) {
            seq = (seq + 1) and 0xffff
            listener.onOutgoing(Rvp(kind, sender, group, seq, 0, 0, spurt, payload))
        }
        rec.startRecording()
        try {
            while (capturing) {
                var got = 0
                while (got < frame.size && capturing) { val n = rec.read(frame, got, frame.size - got); if (n <= 0) break; got += n }
                if (got < frame.size) continue
                for (i in frame.indices) { val x = frame[i].toDouble(); py = a * (py + x - px); px = x; frame[i] = py.toInt().coerceIn(-32768, 32767).toShort() }
                val f = frame.copyOf()
                when (vad.frame(f)) {
                    "start" -> {
                        spurt = (spurt + 1) and 0xffff
                        talking = true; report(true)
                        while (preroll.isNotEmpty()) encoder.encode(preroll.removeFirst()) { send(Rvp.VOICE, it) }
                    }
                    "end" -> { encoder.encode(f) { send(Rvp.VOICE, it) }; send(Rvp.END, ByteArray(0)); talking = false; report(true); continue }
                }
                if (vad.on) encoder.encode(f) { send(Rvp.VOICE, it) }
                else { preroll.addLast(f); if (preroll.size > 5) preroll.removeFirst() }
            }
            if (talking) send(Rvp.END, ByteArray(0))
        } finally { encoder.release() }
    }

    // ---------------------------------------------------------------- playback
    private class Rider(val decoder: OpusDecoder) {
        val chunks = ArrayDeque<ShortArray>()
        var offset = 0
        var buffered = 0
        var primed = false
        var heard = 0L
        var ended = false
    }
    private val riders = HashMap<Long, Rider>()
    private val decodeQueue = Executors.newSingleThreadExecutor { r -> Thread(r, "rylaide-voice-decode") }
    private var playThread: Thread? = null

    /** A packet from any link (already checked for group and duplicates). */
    fun play(p: Rvp) {
        if (!running || p.sender == sender) return
        val r = synchronized(riders) {
            riders.getOrPut(p.sender) { Rider(OpusDecoder()) }.also {
                if (p.kind == Rvp.END) it.ended = true else { it.heard = System.currentTimeMillis(); it.ended = false }
            }
        }
        if (p.kind != Rvp.VOICE || p.payload.isEmpty()) return
        decodeQueue.execute {
            runCatching {
                r.decoder.decode(p.payload) { pcm -> synchronized(riders) { r.chunks.addLast(pcm); r.buffered += pcm.size } }
            }
        }
    }

    private fun playLoop() {
        Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
        val min = AudioTrack.getMinBufferSize(OpusSpec.RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val track = AudioTrack.Builder()
            .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
            .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(OpusSpec.RATE).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
            .setBufferSizeInBytes(maxOf(min, OpusSpec.FRAME * 2 * 3))
            .setTransferMode(AudioTrack.MODE_STREAM)
            .setPerformanceMode(AudioTrack.PERFORMANCE_MODE_LOW_LATENCY)
            .build()
        track.play()
        val mix = IntArray(OpusSpec.FRAME)
        val out = ShortArray(OpusSpec.FRAME)
        val prime = OpusSpec.FRAME * 3        // 60 ms jitter buffer
        val tooMuch = OpusSpec.FRAME * 15     // 300 ms behind: skip ahead
        var tick = 0
        try {
            while (running) {
                java.util.Arrays.fill(mix, 0)
                synchronized(riders) {
                    for (r in riders.values) {
                        if (!r.primed) { if (r.buffered >= prime || (r.ended && r.buffered > 0)) r.primed = true else continue }
                        while (r.buffered > tooMuch) { val c = r.chunks.removeFirst(); r.buffered -= c.size - r.offset; r.offset = 0 }
                        if (r.buffered < OpusSpec.FRAME && !r.ended) { r.primed = false; continue }
                        var need = OpusSpec.FRAME; var i = 0
                        while (need > 0 && r.chunks.isNotEmpty()) {
                            val c = r.chunks.first()
                            val take = minOf(need, c.size - r.offset)
                            for (k in 0 until take) mix[i + k] += c[r.offset + k].toInt()
                            i += take; need -= take; r.offset += take; r.buffered -= take
                            if (r.offset >= c.size) { r.chunks.removeFirst(); r.offset = 0 }
                        }
                        if (r.buffered <= 0) r.primed = false
                    }
                }
                for (k in out.indices) out[k] = mix[k].coerceIn(-32768, 32767).toShort()
                track.write(out, 0, out.size) // blocking: paces this loop at real time
                if (++tick % 8 == 0) report(false)
            }
        } finally { runCatching { track.stop() }; track.release() }
    }

    // ---------------------------------------------------------------- state to the UI
    private var lastState = ""
    private fun report(force: Boolean) {
        val now = System.currentTimeMillis()
        val speakers = synchronized(riders) { riders.filter { !it.value.ended && now - it.value.heard < 400 }.keys.sorted() }
        val mic = when { error != null -> "error"; muted -> "muted"; else -> "live" }
        val key = "$talking|$speakers|$mic|$error"
        if (!force && key == lastState) return
        lastState = key
        listener.onState(talking, speakers, mic, error)
    }
}
