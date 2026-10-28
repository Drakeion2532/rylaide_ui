package com.rylaide.app.voice

import android.media.MediaCodec
import android.media.MediaFormat
import android.os.Build
import android.annotation.TargetApi
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** 48 kHz mono, 20 ms frames: the same Opus settings as the web app and the iPhone app. */
object OpusSpec {
    const val RATE = 48_000
    const val FRAME = 960            // samples per 20 ms
    const val BITRATE = 24_000
    const val PRE_SKIP = 312         // libopus default encoder delay at 48 kHz
}

/** Android's built-in Opus encoder (Android 10+). One 20 ms PCM frame in, one raw Opus packet out. */
@TargetApi(Build.VERSION_CODES.Q)
class OpusEncoder {
    private val codec: MediaCodec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_OPUS)
    private val info = MediaCodec.BufferInfo()
    private var ptsUs = 0L

    init {
        val f = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_OPUS, OpusSpec.RATE, 1)
        f.setInteger(MediaFormat.KEY_BIT_RATE, OpusSpec.BITRATE)
        f.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, OpusSpec.FRAME * 2)
        f.setInteger(MediaFormat.KEY_COMPLEXITY, 7)
        codec.configure(f, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        codec.start()
    }

    /** Feeds one frame of 16-bit PCM; returns the Opus packets that came out (usually exactly one). */
    fun encode(pcm: ShortArray, out: (ByteArray) -> Unit) {
        val i = codec.dequeueInputBuffer(10_000)
        if (i >= 0) {
            val buf = codec.getInputBuffer(i)!!
            buf.clear()
            buf.order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().put(pcm)
            codec.queueInputBuffer(i, 0, pcm.size * 2, ptsUs, 0)
            ptsUs += 20_000
        }
        drain(out)
    }

    private fun drain(out: (ByteArray) -> Unit) {
        while (true) {
            val o = codec.dequeueOutputBuffer(info, 0)
            if (o < 0) return
            val buf = codec.getOutputBuffer(o)!!
            if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0 && info.size > 0) {
                val packet = ByteArray(info.size)
                buf.position(info.offset); buf.get(packet)
                out(packet)
            }
            codec.releaseOutputBuffer(o, false)
        }
    }

    fun release() { runCatching { codec.stop() }; runCatching { codec.release() } }
}

/** One decoder per rider. Raw Opus packet in, 16-bit PCM out. */
@TargetApi(Build.VERSION_CODES.Q)
class OpusDecoder {
    private val codec: MediaCodec = MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_AUDIO_OPUS)
    private val info = MediaCodec.BufferInfo()
    private var ptsUs = 0L

    init {
        val f = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_OPUS, OpusSpec.RATE, 1)
        f.setByteBuffer("csd-0", ByteBuffer.wrap(opusHead()))
        f.setByteBuffer("csd-1", le64(OpusSpec.PRE_SKIP * 1_000_000_000L / OpusSpec.RATE))
        f.setByteBuffer("csd-2", le64(80_000_000L)) // seek pre-roll, 80 ms
        codec.configure(f, null, null, 0)
        codec.start()
    }

    fun decode(packet: ByteArray, out: (ShortArray) -> Unit) {
        val i = codec.dequeueInputBuffer(10_000)
        if (i >= 0) {
            val buf = codec.getInputBuffer(i)!!
            buf.clear(); buf.put(packet)
            codec.queueInputBuffer(i, 0, packet.size, ptsUs, 0)
            ptsUs += 20_000
        }
        while (true) {
            val o = codec.dequeueOutputBuffer(info, 5_000)
            if (o < 0) return
            if (info.size > 0) {
                val buf = codec.getOutputBuffer(o)!!
                buf.position(info.offset); buf.limit(info.offset + info.size)
                val pcm = ShortArray(info.size / 2)
                buf.order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(pcm)
                out(pcm)
            }
            codec.releaseOutputBuffer(o, false)
        }
    }

    fun release() { runCatching { codec.stop() }; runCatching { codec.release() } }

    private fun le64(v: Long): ByteBuffer = ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN).putLong(v).also { it.flip() }

    /** RFC 7845 identification header, mono 48 kHz. */
    private fun opusHead(): ByteArray = ByteBuffer.allocate(19).order(ByteOrder.LITTLE_ENDIAN).apply {
        put("OpusHead".toByteArray(Charsets.US_ASCII)); put(1); put(1)
        putShort(OpusSpec.PRE_SKIP.toShort()); putInt(OpusSpec.RATE); putShort(0); put(0)
    }.array()
}

/** Same voice detector as the web app (livevoice.js): sends only while you speak, learns wind and engine noise. */
class VoiceDetector(sensitivity: String = "normal") {
    private var floor = 0.004
    private var k = 3.0
    private var hits = 0
    private var quiet = 0
    var on = false; private set

    init { setSensitivity(sensitivity) }
    fun setSensitivity(s: String) { k = when (s) { "low" -> 4.5; "high" -> 2.0; else -> 3.0 } }

    /** One 20 ms frame. Returns "start", "end" or null. */
    fun frame(pcm: ShortArray): String? {
        var sum = 0.0
        for (s in pcm) { val f = s / 32768.0; sum += f * f }
        val rms = Math.sqrt(sum / pcm.size)
        floor = if (rms < floor) floor * 0.8 + rms * 0.2 else if (on) floor * 0.9985 + rms * 0.0015 else floor * 0.995 + rms * 0.005
        floor = maxOf(floor, 0.0005)
        val loud = rms > maxOf(floor * k, 0.006)
        if (!on) {
            hits = if (loud) hits + 1 else 0
            if (hits >= 2) { on = true; quiet = 0; return "start" }
            return null
        }
        quiet = if (loud) 0 else quiet + 1
        if (quiet >= 30) { on = false; hits = 0; return "end" }
        return null
    }
}
