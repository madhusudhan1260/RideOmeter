package com.ridewave.app.voice

import android.annotation.SuppressLint
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.os.Process
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ConcurrentLinkedDeque
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Offline push-to-talk voice over Nearby BYTES payloads.
 *
 * Codec: 8 kHz mono, G.711 μ-law (64 kbps), 20 ms frames, 3 frames per packet
 * (≈ 480 B every 60 ms). Chosen because it is trivial, robust and fits the
 * Wi-Fi-upgraded Nearby link; Opus via MediaCodec (API 29+) is the planned upgrade
 * (the packet header carries a codec byte for that).
 *
 * Packet: [codec u8][seq u16][frames u8][μ-law samples...]
 *
 * Capture uses VOICE_COMMUNICATION, so with the helmet set as communication device
 * Android takes the mic from the headset (HFP/SCO). Playback mixes all talkers with
 * a small per-talker jitter buffer.
 *
 * Status: proof-of-concept — needs latency/quality measurement on real devices.
 */
class VoiceEngine(private val send: (ByteArray) -> Unit, private val onLevel: (String, Float) -> Unit) {
    companion object {
        const val SAMPLE_RATE = 8000
        const val FRAME_SAMPLES = 160 // 20 ms
        const val FRAMES_PER_PACKET = 3
        const val CODEC_ULAW: Byte = 1
        private const val JITTER_START = 3 // frames buffered before a talker starts playing
        private const val JITTER_MAX = 15 // 300 ms; older frames are dropped
    }

    @Volatile private var running = false
    @Volatile var transmitting = false
    private var seq = 0
    private var captureThread: Thread? = null
    private var playThread: Thread? = null
    private val talkers = ConcurrentHashMap<String, Talker>()

    private class Talker {
        val frames = ConcurrentLinkedDeque<ShortArray>()
        var started = false
        var lastSeq = -1
        var lastLevelAt = 0L
    }

    fun start() {
        if (running) return
        running = true
        captureThread = Thread({ captureLoop() }, "rw-voice-capture").also { it.start() }
        playThread = Thread({ playLoop() }, "rw-voice-play").also { it.start() }
    }

    fun stop() {
        running = false
        transmitting = false
        captureThread?.join(500)
        playThread?.join(500)
        talkers.clear()
    }

    /** Incoming packet from another rider (already de-framed from the Nearby envelope). */
    fun receive(talkerId: String, packet: ByteArray) {
        if (!running || packet.size < 4 || packet[0] != CODEC_ULAW) return
        val bb = ByteBuffer.wrap(packet)
        bb.get()
        val s = bb.short.toInt() and 0xFFFF
        val n = bb.get().toInt() and 0xFF
        val t = talkers.getOrPut(talkerId) { Talker() }
        if (t.lastSeq >= 0 && ((s - t.lastSeq) and 0xFFFF) > 0x8000) return // old/reordered packet
        t.lastSeq = s
        var level = 0.0
        repeat(n) {
            if (bb.remaining() < FRAME_SAMPLES) return@repeat
            val frame = ShortArray(FRAME_SAMPLES) { ulawToLinear(bb.get()) }
            frame.forEach { v -> level += v.toDouble() * v }
            t.frames.addLast(frame)
        }
        while (t.frames.size > JITTER_MAX) t.frames.pollFirst()
        val now = System.currentTimeMillis()
        if (now - t.lastLevelAt > 250) {
            t.lastLevelAt = now
            val rms = sqrt(level / max(1, n * FRAME_SAMPLES)) / Short.MAX_VALUE
            onLevel(talkerId, rms.toFloat())
        }
    }

    @SuppressLint("MissingPermission") // RECORD_AUDIO is requested in JS before start()
    private fun captureLoop() {
        Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
        val minBuf = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val rec = AudioRecord(
            MediaRecorder.AudioSource.VOICE_COMMUNICATION,
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            max(minBuf, FRAME_SAMPLES * 2 * 8),
        )
        if (rec.state != AudioRecord.STATE_INITIALIZED) {
            rec.release()
            return
        }
        rec.startRecording()
        val frame = ShortArray(FRAME_SAMPLES)
        val packet = ByteBuffer.allocate(4 + FRAME_SAMPLES * FRAMES_PER_PACKET)
        var framesInPacket = 0
        try {
            while (running) {
                val read = rec.read(frame, 0, FRAME_SAMPLES)
                if (read <= 0) continue
                if (!transmitting) {
                    framesInPacket = 0
                    continue
                }
                if (framesInPacket == 0) {
                    packet.clear()
                    packet.put(CODEC_ULAW)
                    packet.putShort((seq++ and 0xFFFF).toShort())
                    packet.put(FRAMES_PER_PACKET.toByte())
                }
                for (i in 0 until FRAME_SAMPLES) packet.put(linearToUlaw(if (i < read) frame[i] else 0))
                framesInPacket++
                if (framesInPacket == FRAMES_PER_PACKET) {
                    send(packet.array().copyOf(packet.position()))
                    framesInPacket = 0
                }
            }
        } finally {
            rec.stop()
            rec.release()
        }
    }

    private fun playLoop() {
        Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
        val minBuf = AudioTrack.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val track = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setSampleRate(SAMPLE_RATE)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .build(),
            )
            .setBufferSizeInBytes(max(minBuf, FRAME_SAMPLES * 2 * 4))
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()
        track.play()
        val mix = IntArray(FRAME_SAMPLES)
        val out = ShortArray(FRAME_SAMPLES)
        try {
            while (running) {
                java.util.Arrays.fill(mix, 0)
                var any = false
                for (t in talkers.values) {
                    if (!t.started && t.frames.size >= JITTER_START) t.started = true
                    if (!t.started) continue
                    val f = t.frames.pollFirst()
                    if (f == null) {
                        t.started = false // underrun: rebuffer
                        continue
                    }
                    any = true
                    for (i in 0 until FRAME_SAMPLES) mix[i] += f[i].toInt()
                }
                if (any) {
                    for (i in 0 until FRAME_SAMPLES) out[i] = min(Short.MAX_VALUE.toInt(), max(Short.MIN_VALUE.toInt(), mix[i])).toShort()
                    track.write(out, 0, FRAME_SAMPLES) // blocking write paces the loop at 20 ms
                } else {
                    Thread.sleep(10)
                }
            }
        } finally {
            track.stop()
            track.release()
        }
    }

    // ---- G.711 μ-law -----------------------------------------------------------

    private fun linearToUlaw(sample: Short): Byte {
        val bias = 0x84
        val clip = 32635
        var pcm = sample.toInt()
        val sign = if (pcm < 0) 0x80 else 0
        if (pcm < 0) pcm = -pcm
        if (pcm > clip) pcm = clip
        pcm += bias
        var exponent = 7
        var mask = 0x4000
        while (exponent > 0 && (pcm and mask) == 0) {
            exponent--
            mask = mask shr 1
        }
        val mantissa = (pcm shr (exponent + 3)) and 0x0F
        return (sign or (exponent shl 4) or mantissa).inv().toByte()
    }

    private fun ulawToLinear(b: Byte): Short {
        val u = b.toInt().inv() and 0xFF
        val sign = u and 0x80
        val exponent = (u shr 4) and 0x07
        val mantissa = u and 0x0F
        var sample = ((mantissa shl 3) + 0x84) shl exponent
        sample -= 0x84
        return (if (sign != 0) -sample else sample).toShort()
    }
}
