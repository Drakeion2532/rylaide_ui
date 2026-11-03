// Copyright (c) 2026 Shubhan Punde · https://github.com/Drakeion2532/rylaide_ui · All rights reserved · sp2532-ce395384fbda
package com.rylaide.app.voice

import java.nio.ByteBuffer

/**
 * RVP — Rylaide Voice Packet. Identical on every link (internet, Bluetooth between phones) and every
 * platform (web, Android, iPhone). Full spec: docs/offline-voice.md.
 *
 *  0  u8   version (1)
 *  1  u8   kind: 1 voice (one 20 ms Opus frame), 2 end of a sentence
 *  2  u32  sender  = fnv32(userId)
 *  6  u32  group   = fnv32(groupId)
 * 10  u16  seq     (per sender, wraps)
 * 12  u8   ttl     (Bluetooth hops left)
 * 13  u8   flags   (bit 0: relayed between the phone mesh and the server by another rider)
 * 14  u16  spurt   (sentence number)
 * 16  …    Opus packet
 * Big-endian.
 */
class Rvp(
    val kind: Int,
    val sender: Long,
    val group: Long,
    val seq: Int,
    var ttl: Int,
    var flags: Int,
    val spurt: Int,
    val payload: ByteArray,
) {
    fun bytes(): ByteArray {
        val b = ByteBuffer.allocate(HEADER + payload.size)
        b.put(VERSION.toByte()).put(kind.toByte())
        b.putInt(sender.toInt()).putInt(group.toInt())
        b.putShort(seq.toShort()).put(ttl.toByte()).put(flags.toByte()).putShort(spurt.toShort())
        b.put(payload)
        return b.array()
    }

    /** Key for dropping the same packet arriving over two links. */
    val key: Long get() = (sender shl 24) xor (seq.toLong() shl 2) xor kind.toLong()

    companion object {
        const val VERSION = 1
        const val HEADER = 16
        const val VOICE = 1
        const val END = 2
        const val GATEWAY = 1
        const val MESH_TTL = 3

        fun parse(b: ByteArray): Rvp? {
            if (b.size < HEADER || b[0].toInt() != VERSION) return null
            val kind = b[1].toInt()
            if (kind != VOICE && kind != END) return null
            val buf = ByteBuffer.wrap(b)
            return Rvp(
                kind = kind,
                sender = buf.getInt(2).toLong() and 0xffffffffL,
                group = buf.getInt(6).toLong() and 0xffffffffL,
                seq = buf.getShort(10).toInt() and 0xffff,
                ttl = b[12].toInt() and 0xff,
                flags = b[13].toInt() and 0xff,
                spurt = buf.getShort(14).toInt() and 0xffff,
                payload = b.copyOfRange(HEADER, b.size),
            )
        }

        /** FNV-1a 32-bit over UTF-8: the same function as the web app, the server and the iPhone app. */
        fun fnv32(s: String): Long {
            var h = 0x811c9dc5L
            for (byte in s.toByteArray(Charsets.UTF_8)) {
                h = h xor (byte.toLong() and 0xff)
                h = (h * 0x01000193L) and 0xffffffffL
            }
            return h
        }
    }
}

/** Keeps the last few seconds of packet keys so a packet heard twice (two links, relays) plays once. */
class Dedupe(private val max: Int = 4000, private val windowMs: Long = 10_000) {
    private val seen = object : LinkedHashMap<Long, Long>(256, 0.75f, false) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Long, Long>?) = size > max
    }
    @Synchronized
    fun firstTime(key: Long, now: Long = System.currentTimeMillis()): Boolean {
        val t = seen[key]
        if (t != null && now - t < windowMs) return false
        seen.remove(key)
        seen[key] = now
        return true
    }
}
