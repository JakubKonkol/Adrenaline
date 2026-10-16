package com.jakubkonkol.adrenaline.tv

import android.content.Context
import android.media.MediaCodecInfo.CodecProfileLevel
import android.media.MediaCodecList
import android.os.Build
import android.view.Display
import android.view.WindowManager
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.audio.AudioCapabilities
import org.json.JSONArray
import org.json.JSONObject

/**
 * DeviceProfile (src/shared/domain/playback.ts) of this Android TV (D-85): decoders from MediaCodecList, HDR formats of
 * the display, Dolby Vision profiles of the DV decoder and the encodings the HDMI sink accepts for passthrough.
 */
object DeviceCapabilities {
    private val VIDEO = mapOf(
        "h264" to "video/avc",
        "hevc" to "video/hevc",
        "vp9" to "video/x-vnd.on2.vp9",
        "av1" to "video/av01",
    )
    private val AUDIO = mapOf(
        "aac" to "audio/mp4a-latm",
        "ac3" to "audio/ac3",
        "eac3" to "audio/eac3",
        "eac3-joc" to "audio/eac3-joc",
        "truehd" to "audio/true-hd",
        "dts" to "audio/vnd.dts",
        "dts-hd" to "audio/vnd.dts.hd",
        "flac" to "audio/flac",
        "opus" to "audio/opus",
        "mp3" to "audio/mpeg",
    )

    /** Dolby Vision decoder profile flags → profile numbers (CodecProfileLevel.DolbyVisionProfile*). */
    private val DV_PROFILES = mapOf(
        CodecProfileLevel.DolbyVisionProfileDvheStn to 5,
        CodecProfileLevel.DolbyVisionProfileDvheDtb to 7,
        CodecProfileLevel.DolbyVisionProfileDvheSt to 8,
        CodecProfileLevel.DolbyVisionProfileDvavSe to 9,
    )

    @Suppress("DEPRECATION")
    @OptIn(UnstableApi::class)
    fun profile(context: Context): JSONObject {
        val decoders = MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.filter { !it.isEncoder }
        val display: Display = (context.getSystemService(Context.WINDOW_SERVICE) as WindowManager).defaultDisplay
        val modes = display.supportedModes
        val maxWidth = modes.maxOfOrNull { it.physicalWidth } ?: 1920
        val maxHeight = modes.maxOfOrNull { it.physicalHeight } ?: 1080

        val video = JSONArray()
        for ((name, mime) in VIDEO) {
            val codecs = decoders.filter { info -> info.supportedTypes.any { it.equals(mime, ignoreCase = true) } }
            if (codecs.isEmpty()) continue
            var w = 0
            var h = 0
            var tenBit = false
            for (info in codecs) {
                val caps = info.getCapabilitiesForType(mime)
                caps.videoCapabilities?.let {
                    w = maxOf(w, it.supportedWidths.upper)
                    h = maxOf(h, it.supportedHeights.upper)
                }
                tenBit = tenBit || caps.profileLevels.any {
                    when (name) {
                        "hevc" -> it.profile == CodecProfileLevel.HEVCProfileMain10 ||
                            it.profile == CodecProfileLevel.HEVCProfileMain10HDR10
                        "vp9" -> it.profile == CodecProfileLevel.VP9Profile2 || it.profile == CodecProfileLevel.VP9Profile2HDR
                        "av1" -> it.profile == CodecProfileLevel.AV1ProfileMain10
                        else -> false
                    }
                }
            }
            video.put(
                JSONObject()
                    .put("codec", name)
                    .put("maxWidth", w.coerceIn(320, 7680))
                    .put("maxHeight", h.coerceIn(240, 4320))
                    .put("tenBit", tenBit),
            )
        }

        val hdrTypes = display.hdrCapabilities?.supportedHdrTypes?.toSet() ?: emptySet()
        val dvProfiles = decoders
            .filter { info -> info.supportedTypes.any { it.equals("video/dolby-vision", ignoreCase = true) } }
            .flatMap { it.getCapabilitiesForType("video/dolby-vision").profileLevels.toList() }
            .mapNotNull { DV_PROFILES[it.profile] }
            .distinct()
            .sorted()
        val dvDisplay = Display.HdrCapabilities.HDR_TYPE_DOLBY_VISION in hdrTypes
        val hdr = JSONObject()
            .put("hdr10", Display.HdrCapabilities.HDR_TYPE_HDR10 in hdrTypes)
            .put(
                "hdr10plus",
                Build.VERSION.SDK_INT >= 29 && Display.HdrCapabilities.HDR_TYPE_HDR10_PLUS in hdrTypes,
            )
            .put("hlg", Display.HdrCapabilities.HDR_TYPE_HLG in hdrTypes)
            .put("dolbyVision", JSONArray(if (dvDisplay) dvProfiles else emptyList()))

        val decode = AUDIO.filter { (_, mime) ->
            decoders.any { info -> info.supportedTypes.any { it.equals(mime, ignoreCase = true) } }
        }.keys
        val sink = AudioCapabilities.getCapabilities(context, AudioAttributes.DEFAULT, null)
        val passthrough = buildList {
            if (sink.supportsEncoding(C.ENCODING_AC3)) add("ac3")
            if (sink.supportsEncoding(C.ENCODING_E_AC3)) add("eac3")
            if (sink.supportsEncoding(C.ENCODING_E_AC3_JOC)) add("eac3-joc")
            if (sink.supportsEncoding(C.ENCODING_DOLBY_TRUEHD)) add("truehd")
            if (sink.supportsEncoding(C.ENCODING_DTS)) add("dts")
            if (sink.supportsEncoding(C.ENCODING_DTS_HD)) add("dts-hd")
        }

        return JSONObject()
            .put("platform", "android")
            .put("model", "${Build.MANUFACTURER} ${Build.MODEL}".take(80))
            .put("maxWidth", maxWidth.coerceIn(320, 7680))
            .put("maxHeight", maxHeight.coerceIn(240, 4320))
            .put("video", video)
            .put("hdr", hdr)
            .put("audioDecode", JSONArray(decode.toList()))
            .put("audioPassthrough", JSONArray(passthrough))
            .put("maxAudioChannels", sink.maxChannelCount.coerceIn(2, 16))
            .put("containers", JSONArray(listOf("mp4", "mkv", "webm", "ts")))
            .put("hls", true)
    }
}
