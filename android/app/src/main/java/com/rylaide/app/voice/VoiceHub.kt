// Copyright (c) 2026 Shubhan Punde · https://github.com/Drakeion2532/rylaide_ui · All rights reserved · sp2532-ce395384fbda
package com.rylaide.app.voice

import android.annotation.TargetApi
import android.content.Context
import android.os.Build
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

/**
 * Joins the voice engine to every link, so going on and offline is seamless:
 *
 *  your voice      → server (when online) and nearby phones (always; the faster path wins, the copy is dropped)
 *  from the server → played; passed to nearby riders who have no signal (you're their gateway)
 *  from a phone    → played; relayed to other nearby phones (ttl); sent to the server if that rider is offline
 *
 * Every packet is checked against the group and dropped if already heard, whichever link it came by.
 */
@TargetApi(Build.VERSION_CODES.Q)
class VoiceHub(context: Context, private val toServer: (ByteArray) -> Unit, private val toUi: (JSONObject) -> Unit) :
    VoiceEngine.Listener, BleMesh.Listener {

    private val engine = VoiceEngine(context, this)
    private val mesh = BleMesh(context, this)
    private val dedupe = Dedupe()
    private var me = 0L
    private var group = 0L
    @Volatile private var online = false
    var meshError: String? = null; private set

    fun start(userId: String, groupId: String, muted: Boolean, noiseCancel: Boolean, sensitivity: String, online: Boolean, meshAllowed: Boolean, speaker: Boolean = false) {
        me = Rvp.fnv32(userId); group = Rvp.fnv32(groupId)
        this.online = online
        engine.start(me, group, muted, noiseCancel, sensitivity, speaker)
        meshError = null
        if (meshAllowed) {
            try { mesh.start(me, group); mesh.setOnline(online) } catch (e: Exception) { meshError = e.message; Log.w("RylaideVoice", "mesh off: ${e.message}") }
        } else meshError = "Allow Nearby devices for offline voice."
        toUi(JSONObject().put("peers", 0).put("meshError", meshError ?: JSONObject.NULL))
    }

    fun stop() { mesh.stop(); engine.stop() }
    fun setMuted(m: Boolean) = engine.setMuted(m)
    val muted: Boolean get() = engine.muted
    fun setNoiseCancel(on: Boolean) = engine.setNoiseCancel(on)
    fun setSensitivity(s: String) = engine.setSensitivity(s)
    /** "speaker" (car rides) or "headset". */
    fun setOutput(out: String) = engine.setSpeaker(out == "speaker")
    fun setOnline(on: Boolean) { online = on; mesh.setOnline(on) }

    // ---------------------------------------------------------------- your voice
    override fun onOutgoing(packet: Rvp) {
        dedupe.firstTime(packet.key) // so our own voice coming back through a relay is ignored
        if (online) toServer(packet.bytes())
        packet.ttl = Rvp.MESH_TTL
        mesh.broadcast(packet.bytes())
    }

    // ---------------------------------------------------------------- from the server (via the web app's socket)
    fun fromServer(bytes: ByteArray) {
        val p = Rvp.parse(bytes) ?: return
        if (p.group != group || !dedupe.firstTime(p.key)) return
        engine.play(p)
        if (mesh.hasOfflinePeers()) {
            p.ttl = Rvp.MESH_TTL
            p.flags = p.flags or Rvp.GATEWAY
            mesh.broadcast(p.bytes(), onlyOffline = true)
        }
    }

    // ---------------------------------------------------------------- from a nearby phone
    override fun onMeshPacket(bytes: ByteArray, from: BleMesh.Peer) {
        val p = Rvp.parse(bytes) ?: return
        if (p.group != group || !dedupe.firstTime(p.key)) return
        engine.play(p)
        if (p.ttl > 0) { p.ttl -= 1; mesh.broadcast(p.bytes(), except = from) }
        // That rider has no signal but we do: carry their voice to the riders who are far away.
        if (online && !from.online && p.sender != me) {
            p.ttl = 0
            p.flags = p.flags or Rvp.GATEWAY
            toServer(p.bytes())
        }
    }

    override fun onPeers(count: Int) { toUi(JSONObject().put("peers", count)) }

    override fun onState(talking: Boolean, speakers: List<Long>, mic: String, error: String?) {
        toUi(JSONObject().put("talking", talking).put("speakers", JSONArray(speakers)).put("mic", mic)
            .put("muted", engine.muted).put("error", error ?: JSONObject.NULL))
    }
}
