// Copyright (c) 2026 Shubhan Punde · https://github.com/Drakeion2532/rylaide_ui · All rights reserved · sp2532-ce395384fbda
package com.rylaide.app.voice

import android.annotation.SuppressLint
import android.annotation.TargetApi
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothServerSocket
import android.bluetooth.BluetoothSocket
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Build
import android.os.ParcelUuid
import android.util.Log
import java.io.BufferedInputStream
import java.io.DataInputStream
import java.io.IOException
import java.nio.ByteBuffer
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/**
 * Offline voice between nearby riders' phones over Bluetooth Low Energy — no internet, no radio, no intercom.
 * Works between Android and iPhone: it uses only standard BLE that both support (docs/offline-voice.md).
 *
 * 1. Every phone advertises the Rylaide service and scans for it.
 * 2. On finding one, it reads the HELLO characteristic: {version, online, L2CAP PSM, rider id, group id}.
 *    Other groups and duplicates are skipped. The rider with the lower id opens the link (the other waits
 *    6 s, then opens it anyway, so one-sided visibility — e.g. an iPhone in the background — still links).
 * 3. Voice goes over an L2CAP channel (a fast BLE data pipe): frames of [u16 length][u8 type][body].
 *    Each phone relays packets onward (ttl 3), so a line of riders carries voice further than one hop.
 */
@TargetApi(Build.VERSION_CODES.Q)
@SuppressLint("MissingPermission") // the service checks Bluetooth permissions before starting the mesh
class BleMesh(private val context: Context, private val listener: Listener) {

    interface Listener {
        fun onMeshPacket(bytes: ByteArray, from: Peer)
        fun onPeers(count: Int)
    }

    companion object {
        private const val TAG = "RylaideMesh"
        val SERVICE: UUID = UUID.fromString("d4f1b2a0-6c2e-4b8e-9f3a-72796c616964")
        val HELLO_CHAR: UUID = UUID.fromString("d4f1b2a1-6c2e-4b8e-9f3a-72796c616964")
        const val FRAME_HELLO = 1
        const val FRAME_RVP = 2
        const val FRAME_STATUS = 3
        const val MAX_PEERS = 6
        const val WAIT_FOR_INBOUND_MS = 6_000L
        private const val MAX_FRAME = 1200
    }

    /** One linked rider. Writes go through a small queue: voice that can't be sent within ~0.4 s is dropped. */
    inner class Peer(val socket: BluetoothSocket, val user: Long, val outgoing: Boolean) {
        @Volatile var online = false
        private val queue = LinkedBlockingQueue<ByteArray>(20)
        private val writer = Thread({
            try {
                val out = socket.outputStream
                while (true) { val f = queue.poll(30, TimeUnit.SECONDS) ?: continue; if (f.isEmpty()) break; out.write(f); out.flush() }
            } catch (_: Exception) { close() }
        }, "rylaide-mesh-w").apply { isDaemon = true; start() }
        fun send(type: Int, body: ByteArray) {
            val f = ByteBuffer.allocate(3 + body.size).putShort((body.size + 1).toShort()).put(type.toByte()).put(body).array()
            if (!queue.offer(f)) { queue.poll(); queue.offer(f) }
        }
        fun close() {
            queue.clear(); queue.offer(ByteArray(0))
            runCatching { socket.close() }
            if (peers.remove(user, this)) listener.onPeers(peers.size)
        }
    }

    private val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    private val adapter: BluetoothAdapter? get() = manager.adapter
    val peers = ConcurrentHashMap<Long, Peer>()
    private val tried = ConcurrentHashMap<String, Long>()       // device address -> last attempt
    private val heardOf = ConcurrentHashMap<Long, Long>()       // rider -> when we first saw them (waiting for their link)
    @Volatile private var running = false
    private var me = 0L
    private var group = 0L
    @Volatile var online = false; private set
    private var server: BluetoothServerSocket? = null
    private var psm = 0
    private var gattServer: BluetoothGattServer? = null

    val available: Boolean get() = adapter?.isEnabled == true

    fun start(me: Long, group: Long) {
        if (running && this.me == me && this.group == group) return
        stop()
        val bt = adapter ?: throw IOException("This phone has no Bluetooth.")
        if (!bt.isEnabled) throw IOException("Bluetooth is off.")
        this.me = me; this.group = group
        running = true
        // L2CAP server: the PSM is published in HELLO.
        server = bt.listenUsingInsecureL2capChannel().also { s ->
            psm = s.psm
            Thread({
                while (running) {
                    val sock = try { s.accept() } catch (_: IOException) { break }
                    Thread({ link(sock, outgoing = false) }, "rylaide-mesh-in").start()
                }
            }, "rylaide-mesh-accept").start()
        }
        // GATT server with the HELLO characteristic.
        gattServer = manager.openGattServer(context, gattServerCallback)?.also { gs ->
            val svc = BluetoothGattService(SERVICE, BluetoothGattService.SERVICE_TYPE_PRIMARY)
            svc.addCharacteristic(BluetoothGattCharacteristic(HELLO_CHAR, BluetoothGattCharacteristic.PROPERTY_READ, BluetoothGattCharacteristic.PERMISSION_READ))
            gs.addService(svc)
        }
        bt.bluetoothLeAdvertiser?.startAdvertising(
            AdvertiseSettings.Builder().setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
                .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH).setConnectable(true).build(),
            AdvertiseData.Builder().addServiceUuid(ParcelUuid(SERVICE)).setIncludeDeviceName(false).build(),
            advertiseCallback,
        )
        bt.bluetoothLeScanner?.startScan(
            listOf(ScanFilter.Builder().setServiceUuid(ParcelUuid(SERVICE)).build()),
            ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(),
            scanCallback,
        )
    }

    fun stop() {
        if (!running) return
        running = false
        runCatching { adapter?.bluetoothLeScanner?.stopScan(scanCallback) }
        runCatching { adapter?.bluetoothLeAdvertiser?.stopAdvertising(advertiseCallback) }
        runCatching { gattServer?.close() }; gattServer = null
        runCatching { server?.close() }; server = null
        peers.values.toList().forEach { it.close() }
        peers.clear(); tried.clear(); heardOf.clear()
        listener.onPeers(0)
    }

    fun setOnline(on: Boolean) {
        if (online == on) return
        online = on
        peers.values.forEach { it.send(FRAME_STATUS, byteArrayOf(if (on) 1 else 0)) }
    }

    /** Send one RVP packet to linked riders (except the one it came from). */
    fun broadcast(rvp: ByteArray, except: Peer? = null, onlyOffline: Boolean = false) {
        for (p in peers.values) if (p !== except && (!onlyOffline || !p.online)) p.send(FRAME_RVP, rvp)
    }
    fun hasOfflinePeers() = peers.values.any { !it.online }

    private fun hello(): ByteArray = ByteBuffer.allocate(12)
        .put(1).put(if (online) 1 else 0).putShort(psm.toShort()).putInt(me.toInt()).putInt(group.toInt()).array()

    private class Hello(val online: Boolean, val psm: Int, val user: Long, val group: Long)
    private fun parseHello(b: ByteArray?): Hello? {
        if (b == null || b.size < 12 || b[0].toInt() != 1) return null
        val v = ByteBuffer.wrap(b)
        return Hello(b[1].toInt() and 1 == 1, v.getShort(2).toInt() and 0xffff, v.getInt(4).toLong() and 0xffffffffL, v.getInt(8).toLong() and 0xffffffffL)
    }

    // ---------------------------------------------------------------- discovery (central)
    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            if (!running || peers.size >= MAX_PEERS) return
            val addr = result.device.address
            val now = System.currentTimeMillis()
            if (now - (tried[addr] ?: 0) < 5_000) return
            tried[addr] = now
            result.device.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
        }
        override fun onScanFailed(errorCode: Int) { Log.w(TAG, "scan failed $errorCode") }
    }

    private val gattCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            if (newState == BluetoothProfile.STATE_CONNECTED && running) g.discoverServices()
            else if (newState == BluetoothProfile.STATE_DISCONNECTED) g.close()
        }
        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            val c = g.getService(SERVICE)?.getCharacteristic(HELLO_CHAR)
            if (c == null || !g.readCharacteristic(c)) g.disconnect()
        }
        @Deprecated("Still called on every API level we support")
        override fun onCharacteristicRead(g: BluetoothGatt, c: BluetoothGattCharacteristic, status: Int) {
            @Suppress("DEPRECATION") val h = parseHello(c.value)
            g.disconnect()
            if (h == null || h.group != group || h.user == me || peers.containsKey(h.user) || !running) return
            val first = heardOf.getOrPut(h.user) { System.currentTimeMillis() }
            // The lower id opens the link; the higher waits in case the other side can't see it, then opens it too.
            if (me > h.user && System.currentTimeMillis() - first < WAIT_FOR_INBOUND_MS) { tried.remove(g.device.address); return }
            val device = g.device
            Thread({
                try {
                    val sock = device.createInsecureL2capChannel(h.psm)
                    sock.connect()
                    link(sock, outgoing = true)
                } catch (e: IOException) { Log.d(TAG, "L2CAP connect failed: ${e.message}") }
            }, "rylaide-mesh-out").start()
        }
    }

    // ---------------------------------------------------------------- discovery (peripheral)
    private val gattServerCallback = object : BluetoothGattServerCallback() {
        override fun onCharacteristicReadRequest(device: BluetoothDevice, requestId: Int, offset: Int, c: BluetoothGattCharacteristic) {
            val v = hello()
            val gs = gattServer ?: return
            if (c.uuid != HELLO_CHAR || offset > v.size) { gs.sendResponse(device, requestId, BluetoothGatt.GATT_FAILURE, offset, null); return }
            gs.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, v.copyOfRange(offset, v.size))
        }
    }
    private val advertiseCallback = object : AdvertiseCallback() {
        override fun onStartFailure(errorCode: Int) { Log.w(TAG, "advertise failed $errorCode") }
    }

    // ---------------------------------------------------------------- the link
    private fun link(sock: BluetoothSocket, outgoing: Boolean) {
        var peer: Peer? = null
        try {
            // Both sides send HELLO first, so the side that accepted learns who called.
            val hi = hello()
            sock.outputStream.write(ByteBuffer.allocate(3 + hi.size).putShort((hi.size + 1).toShort()).put(FRAME_HELLO.toByte()).put(hi).array())
            sock.outputStream.flush()
            val input = DataInputStream(BufferedInputStream(sock.inputStream))
            val (type0, body0) = readFrame(input)
            val h = parseHello(body0)
            if (type0 != FRAME_HELLO || h == null || h.group != group || h.user == me) { sock.close(); return }
            val p = Peer(sock, h.user, outgoing).also { it.online = h.online }
            val existing = peers.putIfAbsent(h.user, p)
            if (existing != null) {
                // Two links to the same rider: keep the one the lower id opened.
                val keepNew = outgoing == (me < h.user) && existing.outgoing != outgoing
                if (!keepNew) { p.close(); return }
                peers[h.user] = p
                existing.close()
            }
            peer = p
            heardOf.remove(h.user)
            listener.onPeers(peers.size)
            while (running) {
                val (type, body) = readFrame(input)
                when (type) {
                    FRAME_RVP -> listener.onMeshPacket(body, p)
                    FRAME_STATUS -> p.online = body.isNotEmpty() && body[0].toInt() == 1
                }
            }
        } catch (_: IOException) {
        } finally {
            peer?.close() ?: runCatching { sock.close() }
        }
    }

    private fun readFrame(input: DataInputStream): Pair<Int, ByteArray> {
        val len = input.readUnsignedShort()
        if (len < 1 || len > MAX_FRAME) throw IOException("bad frame")
        val type = input.readUnsignedByte()
        val body = ByteArray(len - 1)
        input.readFully(body)
        return type to body
    }
}
