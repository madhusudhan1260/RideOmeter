package com.ridewave.app.audio

import android.annotation.SuppressLint
import android.content.ContentUris
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioFocusRequest
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.ToneGenerator
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.security.MessageDigest
import kotlin.concurrent.thread
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.sqrt

/**
 * Helmet / headset audio routing, audio self-tests, the on-device music library
 * and the ride foreground service.
 *
 * The OS owns Bluetooth pairing. We only read what AudioManager reports and pick
 * the communication device; we never claim a device works without a test.
 */
class RideWaveAudioModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
    override fun getName() = "RideWaveAudio"

    private val am: AudioManager by lazy { ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager }
    private val main = Handler(Looper.getMainLooper())

    private val deviceCallback = object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>) = emitDevices()
        override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>) = emitDevices()
    }
    private var registered = false

    // ---------------------------------------------------------------- devices

    private fun typeName(t: Int): String = when (t) {
        AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "BLUETOOTH_SCO"
        AudioDeviceInfo.TYPE_BLUETOOTH_A2DP -> "BLUETOOTH_A2DP"
        AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES -> "WIRED"
        AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_USB_DEVICE -> "USB"
        AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "SPEAKER"
        AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "EARPIECE"
        else -> if (Build.VERSION.SDK_INT >= 31 && (t == AudioDeviceInfo.TYPE_BLE_HEADSET || t == AudioDeviceInfo.TYPE_BLE_SPEAKER)) "BLE_HEADSET" else "OTHER"
    }

    private fun sha256(s: String): String =
        MessageDigest.getInstance("SHA-256").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }

    private fun deviceMap(d: AudioDeviceInfo): WritableMap = Arguments.createMap().apply {
        putInt("id", d.id)
        putString("type", typeName(d.type))
        putString("name", d.productName?.toString() ?: typeName(d.type))
        putBoolean("isSink", d.isSink)
        putBoolean("isSource", d.isSource)
        val addr = if (Build.VERSION.SDK_INT >= 28) d.address else ""
        if (addr.isNullOrEmpty()) putNull("addressHash") else putString("addressHash", sha256(addr.uppercase()))
    }

    /** One entry per physical device (merging the sink and source halves of a headset). */
    private fun currentDevices(): List<AudioDeviceInfo> {
        val all = am.getDevices(AudioManager.GET_DEVICES_ALL)
        val seen = HashSet<String>()
        return all.filter { d ->
            val key = "${d.type}|${d.productName}|${if (Build.VERSION.SDK_INT >= 28) d.address else ""}|${d.isSink}"
            seen.add(key) && d.type != AudioDeviceInfo.TYPE_TELEPHONY && d.type != AudioDeviceInfo.TYPE_BUILTIN_MIC
        }
    }

    private fun emitDevices() {
        if (!ctx.hasActiveReactInstance()) return
        val arr = Arguments.createArray()
        currentDevices().forEach { arr.pushMap(deviceMap(it)) }
        ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("audio:devices", Arguments.createMap().apply { putArray("devices", arr) })
    }

    @ReactMethod
    fun getDevices(promise: Promise) {
        if (!registered) {
            am.registerAudioDeviceCallback(deviceCallback, main)
            registered = true
        }
        val arr = Arguments.createArray()
        currentDevices().forEach { arr.pushMap(deviceMap(it)) }
        promise.resolve(arr)
    }

    @ReactMethod
    fun getCommunicationDevice(promise: Promise) {
        if (Build.VERSION.SDK_INT >= 31) {
            promise.resolve(am.communicationDevice?.let { deviceMap(it) })
        } else {
            @Suppress("DEPRECATION")
            val sco = am.isBluetoothScoOn
            promise.resolve(if (sco) currentDevices().firstOrNull { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }?.let { deviceMap(it) } else null)
        }
    }

    @ReactMethod
    fun setCommunicationDevice(id: Int, promise: Promise) {
        try {
            am.mode = AudioManager.MODE_IN_COMMUNICATION
            if (Build.VERSION.SDK_INT >= 31) {
                val target = am.availableCommunicationDevices.firstOrNull { it.id == id }
                    ?: am.availableCommunicationDevices.firstOrNull { d ->
                        // The id from getDevices may be the A2DP half; match the same product's SCO/BLE half.
                        val ref = am.getDevices(AudioManager.GET_DEVICES_ALL).firstOrNull { it.id == id }
                        ref != null && d.productName == ref.productName
                    }
                promise.resolve(target != null && am.setCommunicationDevice(target))
            } else {
                @Suppress("DEPRECATION")
                run {
                    am.startBluetoothSco()
                    am.isBluetoothScoOn = true
                }
                promise.resolve(true)
            }
        } catch (e: Exception) {
            promise.reject("ROUTE", e)
        }
    }

    @ReactMethod
    fun clearCommunicationDevice(promise: Promise) {
        if (Build.VERSION.SDK_INT >= 31) am.clearCommunicationDevice()
        else @Suppress("DEPRECATION") run {
            am.isBluetoothScoOn = false
            am.stopBluetoothSco()
        }
        am.mode = AudioManager.MODE_NORMAL
        promise.resolve(null)
    }

    // ---------------------------------------------------------------- tests

    @ReactMethod
    fun playTestTone(durationMs: Int, promise: Promise) {
        try {
            val tg = ToneGenerator(AudioManager.STREAM_VOICE_CALL, 85)
            val played = tg.startTone(ToneGenerator.TONE_PROP_BEEP2, durationMs)
            main.postDelayed({ tg.release() }, durationMs.toLong() + 200)
            val routed = if (Build.VERSION.SDK_INT >= 31) am.communicationDevice?.let { deviceMap(it) } else null
            promise.resolve(Arguments.createMap().apply {
                putBoolean("played", played)
                if (routed != null) putMap("routedTo", routed) else putNull("routedTo")
            })
        } catch (e: Exception) {
            promise.reject("TONE", e)
        }
    }

    @SuppressLint("MissingPermission")
    @ReactMethod
    fun micTest(durationMs: Int, promise: Promise) {
        thread(name = "rw-mic-test") {
            val rate = 16000
            val minBuf = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
            val rec = try {
                AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, max(minBuf, 4096))
            } catch (e: Exception) {
                promise.reject("MIC", "Microphone unavailable: ${e.message}")
                return@thread
            }
            if (rec.state != AudioRecord.STATE_INITIALIZED) {
                rec.release()
                promise.reject("MIC", "Microphone permission missing or mic busy")
                return@thread
            }
            val buf = ShortArray(1024)
            var sumSq = 0.0
            var n = 0L
            var peak = 0
            rec.startRecording()
            val end = System.currentTimeMillis() + durationMs
            while (System.currentTimeMillis() < end) {
                val r = rec.read(buf, 0, buf.size)
                for (i in 0 until max(r, 0)) {
                    val v = buf[i].toInt()
                    sumSq += v.toDouble() * v
                    if (kotlin.math.abs(v) > peak) peak = kotlin.math.abs(v)
                }
                n += max(r, 0)
            }
            val source = if (Build.VERSION.SDK_INT >= 24) rec.routedDevice else null
            rec.stop()
            rec.release()
            val rms = if (n > 0) sqrt(sumSq / n) / Short.MAX_VALUE else 0.0
            promise.resolve(Arguments.createMap().apply {
                putDouble("rmsDb", 20 * log10(max(rms, 1e-6)))
                putDouble("peakDb", 20 * log10(max(peak.toDouble() / Short.MAX_VALUE, 1e-6)))
                if (source != null) putMap("source", deviceMap(source)) else putNull("source")
            })
        }
    }

    // ---------------------------------------------------------------- music library

    @ReactMethod
    fun listLocalTracks(promise: Promise) {
        thread(name = "rw-media-scan") {
            try {
                val uri = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
                val cols = arrayOf(
                    MediaStore.Audio.Media._ID, MediaStore.Audio.Media.TITLE, MediaStore.Audio.Media.ARTIST,
                    MediaStore.Audio.Media.ALBUM, MediaStore.Audio.Media.DURATION, MediaStore.Audio.Media.SIZE,
                )
                val arr = Arguments.createArray()
                ctx.contentResolver.query(uri, cols, "${MediaStore.Audio.Media.IS_MUSIC} != 0", null, "${MediaStore.Audio.Media.TITLE} ASC")?.use { c ->
                    while (c.moveToNext()) {
                        val id = c.getLong(0)
                        arr.pushMap(Arguments.createMap().apply {
                            putString("uri", ContentUris.withAppendedId(uri, id).toString())
                            putString("title", c.getString(1) ?: "Unknown")
                            c.getString(2)?.takeIf { it != "<unknown>" }?.let { putString("artist", it) } ?: putNull("artist")
                            c.getString(3)?.let { putString("album", it) } ?: putNull("album")
                            putDouble("durationMs", c.getLong(4).toDouble())
                            putDouble("sizeBytes", c.getLong(5).toDouble())
                        })
                    }
                }
                promise.resolve(arr)
            } catch (e: SecurityException) {
                promise.reject("PERMISSION", "Allow access to music files")
            } catch (e: Exception) {
                promise.reject("SCAN", e)
            }
        }
    }

    /** Content fingerprint shared by every phone holding the same file: sha256(size || first 1 MB). */
    @ReactMethod
    fun fingerprint(uriStr: String, promise: Promise) {
        thread(name = "rw-fingerprint") {
            try {
                val uri = Uri.parse(uriStr)
                val size = ctx.contentResolver.openAssetFileDescriptor(uri, "r")?.use { it.length } ?: -1L
                val md = MessageDigest.getInstance("SHA-256")
                md.update(size.toString().toByteArray())
                ctx.contentResolver.openInputStream(uri)?.use { input ->
                    val buf = ByteArray(64 * 1024)
                    var left = 1024 * 1024
                    while (left > 0) {
                        val r = input.read(buf, 0, minOf(buf.size, left))
                        if (r <= 0) break
                        md.update(buf, 0, r)
                        left -= r
                    }
                } ?: throw IllegalStateException("Cannot open file")
                promise.resolve(md.digest().joinToString("") { "%02x".format(it) })
            } catch (e: Exception) {
                promise.reject("FINGERPRINT", e)
            }
        }
    }

    // ---------------------------------------------------------------- text-to-speech

    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private val focusAttrs = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build()
    private val focusRequest by lazy {
        AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK).setAudioAttributes(focusAttrs).build()
    }

    @ReactMethod
    fun ttsInit(promise: Promise) {
        if (ttsReady) return promise.resolve(true)
        main.post {
            tts = TextToSpeech(ctx) { status ->
                ttsReady = status == TextToSpeech.SUCCESS
                if (ttsReady) {
                    tts?.setAudioAttributes(focusAttrs)
                    tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                        override fun onStart(id: String) {}
                        override fun onDone(id: String) = ttsFinished(id, "done")
                        @Deprecated("Deprecated in Java")
                        override fun onError(id: String) = ttsFinished(id, "error")
                        override fun onStop(id: String, interrupted: Boolean) = ttsFinished(id, "cancel")
                    })
                }
                promise.resolve(ttsReady)
            }
        }
    }

    /** Speaks with transient focus so other apps (Spotify) duck; resolves immediately, completion comes as tts:finish. */
    @ReactMethod
    fun ttsSpeak(text: String, id: String, promise: Promise) {
        val engine = tts
        if (!ttsReady || engine == null) return promise.reject("TTS", "Text-to-speech engine not available")
        am.requestAudioFocus(focusRequest)
        val r = engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, id)
        if (r != TextToSpeech.SUCCESS) {
            am.abandonAudioFocusRequest(focusRequest)
            return promise.reject("TTS", "speak failed")
        }
        promise.resolve(null)
    }

    @ReactMethod
    fun ttsStop(promise: Promise) {
        tts?.stop()
        promise.resolve(null)
    }

    private fun ttsFinished(id: String, kind: String) {
        am.abandonAudioFocusRequest(focusRequest)
        if (!ctx.hasActiveReactInstance()) return
        ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("tts:finish", Arguments.createMap().apply { putString("id", id); putString("kind", kind) })
    }

    // ---------------------------------------------------------------- foreground service

    @ReactMethod
    fun startRideService(title: String, text: String, withMic: Boolean, promise: Promise) {
        try {
            val i = Intent(ctx, RideService::class.java).putExtra("title", title).putExtra("text", text).putExtra("mic", withMic)
            ContextCompat.startForegroundService(ctx, i)
            promise.resolve(null)
        } catch (e: Exception) {
            // Android 12+ blocks starting from background; the ride still works while the app is open.
            promise.reject("SERVICE", e)
        }
    }

    @ReactMethod
    fun stopRideService(promise: Promise) {
        ctx.stopService(Intent(ctx, RideService::class.java))
        promise.resolve(null)
    }

    @ReactMethod fun addListener(@Suppress("UNUSED_PARAMETER") eventName: String) {}
    @ReactMethod fun removeListeners(@Suppress("UNUSED_PARAMETER") count: Double) {}

    override fun invalidate() {
        tts?.shutdown()
        tts = null
        ttsReady = false
        if (registered) am.unregisterAudioDeviceCallback(deviceCallback)
        registered = false
        super.invalidate()
    }
}
