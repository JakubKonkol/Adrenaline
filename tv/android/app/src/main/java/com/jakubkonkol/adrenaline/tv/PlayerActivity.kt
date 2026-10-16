package com.jakubkonkol.adrenaline.tv

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.KeyEvent
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import org.json.JSONObject

/**
 * Native player (D-85): Media3 plays the original file (direct play, with every audio/subtitle track of the file and
 * passthrough of E-AC3/Atmos, TrueHD and DTS to the receiver when the HDMI sink accepts them) or the HLS stream the PC
 * converts. Positions reported back to the web app are positions in the film (`offsetMs` + player position).
 */
@OptIn(UnstableApi::class)
class PlayerActivity : ComponentActivity() {
    private lateinit var player: ExoPlayer
    private lateinit var request: JSONObject
    private var offsetMs = 0L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        request = JSONObject(intent.getStringExtra(EXTRA_REQUEST) ?: "{}")
        offsetMs = request.optLong("offsetMs", 0)

        // Decoders of the TV first, FFmpeg-free; audio goes out bit-exact when the sink supports the encoding.
        val renderers = DefaultRenderersFactory(this).setEnableDecoderFallback(true)
        player = ExoPlayer.Builder(this, renderers).build()
        val view = PlayerView(this).apply {
            this.player = this@PlayerActivity.player
            setShowSubtitleButton(true)
            controllerShowTimeoutMs = 4_000
            keepScreenOn = true
        }
        setContentView(view)

        val subtitles = mutableListOf<MediaItem.SubtitleConfiguration>()
        val tracks = request.optJSONArray("subtitleTracks")
        var firstExternal = true
        for (i in 0 until (tracks?.length() ?: 0)) {
            val track = tracks!!.getJSONObject(i)
            val url = track.optString("url").takeIf { it.isNotEmpty() && it != "null" } ?: continue
            // Embedded tracks of a direct-play file are read by Media3 from the file itself.
            if (track.optString("kind") != "external" && !hls) continue
            subtitles += MediaItem.SubtitleConfiguration.Builder(Uri.parse(url))
                .setMimeType(MimeTypes.TEXT_VTT)
                .setLabel(track.optString("label"))
                .setId(track.optString("id"))
                .setSelectionFlags(if (firstExternal) C.SELECTION_FLAG_DEFAULT else 0)
                .build()
            firstExternal = false
        }
        val item = MediaItem.Builder()
            .setUri(Uri.parse(request.getString("url")))
            .setMimeType(if (hls) MimeTypes.APPLICATION_M3U8 else null)
            .setSubtitleConfigurations(subtitles)
            .build()
        player.setMediaItem(item, request.optLong("startMs", 0))
        player.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_ENDED) close(ended = true)
            }

            override fun onPlayerError(error: PlaybackException) {
                close(ended = false)
            }

            override fun onTracksChanged(tracks: androidx.media3.common.Tracks) {
                selectRequestedAudio(tracks)
            }
        })
        player.prepare()
        player.playWhenReady = true

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (view.isControllerFullyVisible) view.hideController() else close(ended = false)
            }
        })
    }

    /** The audio track chosen in the app (ffprobe index → n-th audio track of the file) for direct play. */
    private var audioApplied = false
    private fun selectRequestedAudio(tracks: androidx.media3.common.Tracks) {
        if (audioApplied || hls) return
        val list = request.optJSONArray("audioTracks") ?: return
        val wanted = (0 until list.length()).firstOrNull { list.getJSONObject(it).optBoolean("selected") } ?: return
        val groups = tracks.groups.filter { it.type == C.TRACK_TYPE_AUDIO }
        val group = groups.getOrNull(wanted) ?: return
        audioApplied = true
        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
            .setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, 0))
            .build()
    }

    /** The PC answers `application/vnd.apple.mpegurl`; Media3 names it `application/x-mpegURL`. */
    private val hls
        get() = request.optString("mimeType").lowercase().let {
            it == "application/vnd.apple.mpegurl" || it == MimeTypes.APPLICATION_M3U8.lowercase()
        }

    /**
     * HLS from the PC grows while it is converted (D-85): a seek past what exists, or before the start of this stream,
     * asks the app for a new stream from that position (`restart` event). The file itself is sought normally.
     */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        // Left/right always seek in a converted stream (the controls stay reachable with up/down and OK).
        if (hls && event.action == KeyEvent.ACTION_DOWN) {
            when (event.keyCode) {
                KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> {
                    seekBy(30_000)
                    return true
                }
                KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_MEDIA_REWIND -> {
                    seekBy(-10_000)
                    return true
                }
            }
        }
        if (event.action == KeyEvent.ACTION_DOWN && event.keyCode == KeyEvent.KEYCODE_MEDIA_STOP) {
            close(ended = false)
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    private fun seekBy(deltaMs: Long) {
        val target = player.currentPosition + deltaMs
        val available = player.duration
        val total = request.optLong("durationMs", -1)
        val absolute = (offsetMs + target).coerceIn(0, if (total > 0) total - 1_000 else Long.MAX_VALUE)
        if (target >= 0 && available != C.TIME_UNSET && target < available - 2_000) player.seekTo(target)
        else restart(absolute)
    }

    private fun restart(absoluteMs: Long) {
        if (closed) return
        closed = true
        val tracks = request.optJSONArray("audioTracks")
        val audio = (0 until (tracks?.length() ?: 0)).map { tracks!!.getJSONObject(it) }.firstOrNull { it.optBoolean("selected") }
        val subs = request.optJSONArray("subtitleTracks")
        val burned = (0 until (subs?.length() ?: 0)).map { subs!!.getJSONObject(it) }.firstOrNull { it.optBoolean("burnedIn") }
        val event = JSONObject()
            .put("type", "restart")
            .put("itemId", request.optString("itemId"))
            .put("positionMs", absoluteMs)
            .put("audioIndex", audio?.optInt("index") ?: JSONObject.NULL)
            .put("subtitleId", burned?.optString("id") ?: JSONObject.NULL)
        setResult(Activity.RESULT_OK, Intent().putExtra(EXTRA_EVENT, event.toString()))
        finish()
    }

    private var closed = false
    private fun close(ended: Boolean) {
        if (closed) return
        closed = true
        val duration = request.optLong("durationMs", -1).takeIf { it > 0 }
            ?: player.duration.takeIf { it != C.TIME_UNSET }?.plus(offsetMs)
        val event = JSONObject()
            .put("type", "closed")
            .put("itemId", request.optString("itemId"))
            .put("positionMs", offsetMs + player.currentPosition.coerceAtLeast(0))
            .put("durationMs", duration ?: JSONObject.NULL)
            .put("ended", ended)
        setResult(Activity.RESULT_OK, Intent().putExtra(EXTRA_EVENT, event.toString()))
        finish()
    }

    override fun onStop() {
        super.onStop()
        // Leaving the app (Home button) ends playback like Back does: the position is kept by the web app.
        if (!isChangingConfigurations) close(ended = false)
    }

    override fun onDestroy() {
        player.release()
        super.onDestroy()
    }

    companion object {
        const val EXTRA_REQUEST = "request"
        const val EXTRA_EVENT = "event"
    }
}
