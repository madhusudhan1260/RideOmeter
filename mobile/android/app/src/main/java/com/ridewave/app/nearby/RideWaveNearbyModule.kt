package com.ridewave.app.nearby

import android.os.Handler
import android.os.Looper
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.nearby.Nearby
import com.google.android.gms.nearby.connection.AdvertisingOptions
import com.google.android.gms.nearby.connection.ConnectionInfo
import com.google.android.gms.nearby.connection.ConnectionLifecycleCallback
import com.google.android.gms.nearby.connection.ConnectionResolution
import com.google.android.gms.nearby.connection.ConnectionsClient
import com.google.android.gms.nearby.connection.ConnectionsStatusCodes
import com.google.android.gms.nearby.connection.DiscoveredEndpointInfo
import com.google.android.gms.nearby.connection.DiscoveryOptions
import com.google.android.gms.nearby.connection.EndpointDiscoveryCallback
import com.google.android.gms.nearby.connection.Payload
import com.google.android.gms.nearby.connection.PayloadCallback
import com.google.android.gms.nearby.connection.PayloadTransferUpdate
import com.google.android.gms.nearby.connection.Strategy
import com.ridewave.app.voice.VoiceEngine
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap

/**
 * Offline ride mesh over Google Nearby Connections, P2P_STAR topology.
 *
 *  HUB (ride admin)  advertises; accepts members; relays every event/voice payload
 *                    from one member to all other authenticated members.
 *  MEMBER            discovers the hub of *this* ride and connects to it.
 *
 * Endpoint name: "RW1|<rideShortId>|<H|M>|<userId>|<displayName>"
 * Payload framing (first byte):
 *   0x01 event JSON (UTF-8)          0x02 voice  [talkerIdLen u8][talkerId][voice packet]
 *   0x10 auth challenge [nonce16]    0x11 auth proof [userIdLen u8][userId][hmac32]
 * Nothing but auth frames is accepted from an endpoint until it has proven the ride key.
 */
class RideWaveNearbyModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
    companion object {
        private const val TAG = "RideWaveNearby"
        private const val SERVICE_ID = "com.ridewave.app.ride"
        private const val T_EVENT: Byte = 0x01
        private const val T_VOICE: Byte = 0x02
        private const val T_CHALLENGE: Byte = 0x10
        private const val T_PROOF: Byte = 0x11
        private const val AUTH_TIMEOUT_MS = 8000L
        private const val MAX_EVENT_BYTES = 30_000 // Nearby BYTES payload limit is 32 KB
    }

    override fun getName() = "RideWaveNearby"

    private val client: ConnectionsClient by lazy { Nearby.getConnectionsClient(ctx) }
    private val main = Handler(Looper.getMainLooper())

    private var rideShortId = ""
    private var userId = ""
    private var displayName = ""
    private var keyHex = ""
    private var isHub = false
    private var running = false

    private data class Peer(
        val endpointId: String,
        var userId: String,
        var name: String,
        val isHub: Boolean,
        var authDigits: String = "",
        var myNonce: ByteArray? = null,
        var authenticated: Boolean = false,
    )

    private val peers = ConcurrentHashMap<String, Peer>()
    private var voice: VoiceEngine? = null

    // ---------------------------------------------------------------- JS API

    @ReactMethod
    fun isAvailable(promise: Promise) {
        val code = GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(ctx)
        val map = Arguments.createMap()
        map.putBoolean("available", code == ConnectionResult.SUCCESS)
        if (code != ConnectionResult.SUCCESS) map.putString("reason", "Google Play services unavailable (code $code)")
        promise.resolve(map)
    }

    @ReactMethod
    fun start(opts: ReadableMap, promise: Promise) {
        try {
            stopInternal()
            rideShortId = opts.getString("rideShortId") ?: throw IllegalArgumentException("rideShortId")
            userId = opts.getString("userId") ?: throw IllegalArgumentException("userId")
            displayName = (opts.getString("displayName") ?: "Rider").replace("|", " ").take(24)
            keyHex = opts.getString("offlineKeyHex") ?: throw IllegalArgumentException("offlineKeyHex")
            PeerAuth.hexToBytes(keyHex) // validate early
            isHub = opts.getString("role") == "HUB"
            running = true
            val name = "RW1|$rideShortId|${if (isHub) "H" else "M"}|$userId|$displayName"
            if (isHub) {
                client.startAdvertising(name, SERVICE_ID, lifecycle, AdvertisingOptions.Builder().setStrategy(Strategy.P2P_STAR).build())
                    .addOnSuccessListener { emitState("advertising") ; promise.resolve(null) }
                    .addOnFailureListener { e -> emitState("error", e.message); promise.reject("ADVERTISE", e) }
            } else {
                startDiscovery(promise)
            }
        } catch (e: Exception) {
            promise.reject("START", e)
        }
    }

    @ReactMethod
    fun stop(promise: Promise) {
        stopInternal()
        promise.resolve(null)
    }

    /** Send an event to the mesh. Returns how many authenticated links it went out on. */
    @ReactMethod
    fun sendEvent(json: String, promise: Promise) {
        val body = json.toByteArray(Charsets.UTF_8)
        if (body.size > MAX_EVENT_BYTES) return promise.reject("TOO_LARGE", "Event exceeds Nearby payload limit")
        val frame = ByteArray(body.size + 1).also { it[0] = T_EVENT; System.arraycopy(body, 0, it, 1, body.size) }
        promise.resolve(broadcast(frame, except = null))
    }

    @ReactMethod
    fun startVoice(promise: Promise) {
        if (voice == null) {
            voice = VoiceEngine(
                send = { packet -> broadcast(voiceFrame(userId, packet), except = null) },
                onLevel = { talker, level -> emitVoice(talker, level) },
            ).also { it.start() }
        }
        promise.resolve(null)
    }

    @ReactMethod
    fun stopVoice(promise: Promise) {
        voice?.stop()
        voice = null
        promise.resolve(null)
    }

    @ReactMethod
    fun setTransmitting(on: Boolean, promise: Promise) {
        voice?.transmitting = on
        promise.resolve(null)
    }

    // Required by NativeEventEmitter.
    @ReactMethod fun addListener(@Suppress("UNUSED_PARAMETER") eventName: String) {}
    @ReactMethod fun removeListeners(@Suppress("UNUSED_PARAMETER") count: Double) {}

    override fun invalidate() {
        stopInternal()
        super.invalidate()
    }

    // ---------------------------------------------------------------- discovery

    private fun startDiscovery(promise: Promise? = null) {
        client.startDiscovery(SERVICE_ID, discovery, DiscoveryOptions.Builder().setStrategy(Strategy.P2P_STAR).build())
            .addOnSuccessListener { emitState("discovering"); promise?.resolve(null) }
            .addOnFailureListener { e ->
                emitState("error", e.message)
                promise?.reject("DISCOVER", e)
            }
    }

    private val discovery = object : EndpointDiscoveryCallback() {
        override fun onEndpointFound(endpointId: String, info: DiscoveredEndpointInfo) {
            val parts = info.endpointName.split("|")
            if (parts.size < 5 || parts[0] != "RW1" || parts[1] != rideShortId || parts[2] != "H") return
            if (peers.containsKey(endpointId)) return
            Log.i(TAG, "found hub $endpointId (${parts[4]})")
            val name = "RW1|$rideShortId|M|$userId|$displayName"
            client.requestConnection(name, endpointId, lifecycle)
                .addOnFailureListener { e -> Log.w(TAG, "requestConnection failed: ${e.message}") }
        }

        override fun onEndpointLost(endpointId: String) {}
    }

    // ---------------------------------------------------------------- connections

    private val lifecycle = object : ConnectionLifecycleCallback() {
        override fun onConnectionInitiated(endpointId: String, info: ConnectionInfo) {
            val parts = info.endpointName.split("|")
            val sameRide = parts.size >= 5 && parts[0] == "RW1" && parts[1] == rideShortId
            // A hub only accepts members; a member only accepts its hub.
            val roleOk = if (isHub) parts.getOrNull(2) == "M" else parts.getOrNull(2) == "H"
            if (!sameRide || !roleOk) {
                client.rejectConnection(endpointId)
                return
            }
            peers[endpointId] = Peer(endpointId, parts[3], parts[4], parts[2] == "H", authDigits = info.authenticationDigits)
            emitPeer(endpointId, "CONNECTING")
            client.acceptConnection(endpointId, payloads)
        }

        override fun onConnectionResult(endpointId: String, result: ConnectionResolution) {
            val peer = peers[endpointId] ?: return
            if (result.status.statusCode != ConnectionsStatusCodes.STATUS_OK) {
                peers.remove(endpointId)
                emitPeer(endpointId, "DISCONNECTED", peer)
                return
            }
            if (!isHub) client.stopDiscovery() // star: one hub is enough; saves battery
            val nonce = PeerAuth.nonce()
            peer.myNonce = nonce
            client.sendPayload(endpointId, Payload.fromBytes(byteArrayOf(T_CHALLENGE) + nonce))
            main.postDelayed({
                val p = peers[endpointId]
                if (p != null && !p.authenticated) {
                    Log.w(TAG, "auth timeout for $endpointId")
                    reject(endpointId)
                }
            }, AUTH_TIMEOUT_MS)
        }

        override fun onDisconnected(endpointId: String) {
            val peer = peers.remove(endpointId)
            emitPeer(endpointId, "DISCONNECTED", peer)
            if (running && !isHub && peers.values.none { it.isHub }) startDiscovery()
            if (peers.values.none { it.authenticated }) emitState(if (isHub) "advertising" else "discovering")
        }
    }

    private val payloads = object : PayloadCallback() {
        override fun onPayloadReceived(endpointId: String, payload: Payload) {
            val bytes = payload.asBytes() ?: return
            if (bytes.isEmpty()) return
            val peer = peers[endpointId] ?: return
            when (bytes[0]) {
                T_CHALLENGE -> answerChallenge(endpointId, peer, bytes.copyOfRange(1, bytes.size))
                T_PROOF -> checkProof(endpointId, peer, bytes)
                T_EVENT -> if (peer.authenticated) {
                    emitEvent(endpointId, String(bytes, 1, bytes.size - 1, Charsets.UTF_8))
                    if (isHub) broadcast(bytes, except = endpointId)
                }
                T_VOICE -> if (peer.authenticated) {
                    val (talker, packet) = parseVoice(bytes) ?: return
                    if (talker == peer.userId || peer.isHub) voice?.receive(talker, packet)
                    if (isHub) broadcast(bytes, except = endpointId)
                }
            }
        }

        override fun onPayloadTransferUpdate(endpointId: String, update: PayloadTransferUpdate) {}
    }

    private fun answerChallenge(endpointId: String, peer: Peer, nonce: ByteArray) {
        if (nonce.size != 16) return reject(endpointId)
        val proof = PeerAuth.prove(keyHex, nonce, rideShortId, userId, peer.authDigits)
        val uid = userId.toByteArray(Charsets.UTF_8)
        val frame = ByteBuffer.allocate(2 + uid.size + proof.size).put(T_PROOF).put(uid.size.toByte()).put(uid).put(proof).array()
        client.sendPayload(endpointId, Payload.fromBytes(frame))
    }

    private fun checkProof(endpointId: String, peer: Peer, bytes: ByteArray) {
        val nonce = peer.myNonce ?: return reject(endpointId)
        if (bytes.size < 3) return reject(endpointId)
        val len = bytes[1].toInt() and 0xFF
        if (bytes.size != 2 + len + 32) return reject(endpointId)
        val claimed = String(bytes, 2, len, Charsets.UTF_8)
        if (claimed != peer.userId) return reject(endpointId)
        val expected = PeerAuth.prove(keyHex, nonce, rideShortId, claimed, peer.authDigits)
        if (!PeerAuth.verify(expected, bytes.copyOfRange(2 + len, bytes.size))) return reject(endpointId)
        peer.authenticated = true
        emitPeer(endpointId, "CONNECTED", peer)
        emitState("connected")
    }

    private fun reject(endpointId: String) {
        val peer = peers.remove(endpointId)
        client.disconnectFromEndpoint(endpointId)
        emitPeer(endpointId, "REJECTED", peer)
    }

    private fun broadcast(frame: ByteArray, except: String?): Int {
        val targets = peers.values.filter { it.authenticated && it.endpointId != except }.map { it.endpointId }
        if (targets.isEmpty()) return 0
        client.sendPayload(targets, Payload.fromBytes(frame))
        return targets.size
    }

    private fun voiceFrame(talker: String, packet: ByteArray): ByteArray {
        val id = talker.toByteArray(Charsets.UTF_8)
        return ByteBuffer.allocate(2 + id.size + packet.size).put(T_VOICE).put(id.size.toByte()).put(id).put(packet).array()
    }

    private fun parseVoice(bytes: ByteArray): Pair<String, ByteArray>? {
        if (bytes.size < 3) return null
        val len = bytes[1].toInt() and 0xFF
        if (bytes.size < 2 + len + 4) return null
        return String(bytes, 2, len, Charsets.UTF_8) to bytes.copyOfRange(2 + len, bytes.size)
    }

    private fun stopInternal() {
        if (!running) return
        running = false
        voice?.stop()
        voice = null
        try {
            client.stopAdvertising()
            client.stopDiscovery()
            client.stopAllEndpoints()
        } catch (e: Exception) {
            Log.w(TAG, "stop: ${e.message}")
        }
        peers.clear()
        emitState("off")
    }

    // ---------------------------------------------------------------- events to JS

    private fun emit(name: String, map: WritableMap) {
        if (!ctx.hasActiveReactInstance()) return
        ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(name, map)
    }

    private fun emitState(state: String, detail: String? = null) =
        emit("nearby:state", Arguments.createMap().apply { putString("state", state); detail?.let { putString("detail", it) } })

    private fun emitPeer(endpointId: String, state: String, peer: Peer? = peers[endpointId]) =
        emit("nearby:peer", Arguments.createMap().apply {
            putString("endpointId", endpointId)
            putString("userId", peer?.userId ?: "")
            putString("name", peer?.name ?: "")
            putString("state", state)
            putBoolean("isHub", peer?.isHub ?: false)
        })

    private fun emitEvent(endpointId: String, json: String) =
        emit("nearby:event", Arguments.createMap().apply { putString("endpointId", endpointId); putString("json", json) })

    private fun emitVoice(talker: String, level: Float) =
        emit("nearby:voice", Arguments.createMap().apply { putString("userId", talker); putDouble("level", level.toDouble()) })
}
