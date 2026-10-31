package com.ridewave.app.nearby

import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Peer authentication for the offline mesh.
 *
 * Every approved ride participant receives the ride's 32-byte offline key from the
 * backend (stored in the Android Keystore-backed keychain). After Nearby connects,
 * each side sends a random nonce and must answer the other's nonce with
 *   HMAC-SHA256(key, nonce || rideShortId || userId || authDigits)
 * authDigits come from Nearby's own key exchange for this connection, binding the
 * proof to this link so it can't be replayed through a relay.
 */
object PeerAuth {
    private val rng = SecureRandom()

    fun nonce(): ByteArray = ByteArray(16).also { rng.nextBytes(it) }

    fun prove(keyHex: String, nonce: ByteArray, rideShortId: String, userId: String, authDigits: String): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(hexToBytes(keyHex), "HmacSHA256"))
        mac.update(nonce)
        mac.update(rideShortId.toByteArray(Charsets.UTF_8))
        mac.update(userId.toByteArray(Charsets.UTF_8))
        mac.update(authDigits.toByteArray(Charsets.UTF_8))
        return mac.doFinal()
    }

    fun verify(expected: ByteArray, actual: ByteArray): Boolean = MessageDigest.isEqual(expected, actual)

    fun hexToBytes(hex: String): ByteArray {
        require(hex.length % 2 == 0) { "bad hex" }
        return ByteArray(hex.length / 2) { i -> hex.substring(i * 2, i * 2 + 2).toInt(16).toByte() }
    }
}
