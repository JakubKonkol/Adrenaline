package com.jakubkonkol.adrenaline.tv

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.view.Gravity
import android.widget.FrameLayout
import android.widget.TextView
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
 * converts. The HLS playlist covers the whole film (VOD), so positions are film positions and seeking is native.
 * An HLS stream carries one audio track chosen by the PC: other tracks, and image subtitles (burned in by the PC), are
 * picked in a menu (MENU or the audio key) that asks the app for a new stream from the current position.
 */
@OptIn(UnstableApi::class)
class PlayerActivity : ComponentActivity() {
    private lateinit var player: ExoPlayer
    private lateinit var request: JSONObject
    private lateinit var view: PlayerView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        request = JSONObject(intent.getStringExtra(EXTRA_REQUEST) ?: "{}")

        // Decoders of the TV first, FFmpeg-free; audio goes out bit-exact when the sink supports the encoding.
        val renderers = DefaultRenderersFactory(this).setEnableDecoderFallback(true)
        player = ExoPlayer.Builder(this, renderers).build()
        view = PlayerView(this).apply {
            this.player = this@PlayerActivity.player
            setShowSubtitleButton(true)
            controllerShowTimeoutMs = 4_000
            keepScreenOn = true
        }
        val root = FrameLayout(this)
        root.addView(view)
        if (hls && pcChoices().isNotEmpty()) {
            // Shown with the controls: where the PC's tracks are.
            val hint = TextView(this).apply {
                text = "MENU  ·  Audio & subtitles"
                setTextColor(Color.WHITE)
                textSize = 16f
                setPadding(32, 16, 32, 16)
                setBackgroundColor(Color.argb(170, 0, 0, 0))
                visibility = android.view.View.GONE
            }
            root.addView(hint, FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.TOP or Gravity.END,
            ).apply { setMargins(0, 48, 48, 0) })
            view.setControllerVisibilityListener(PlayerView.ControllerVisibilityListener { visibility ->
                hint.visibility = visibility
            })
        }
        setContentView(root)

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
     * Left/right seek while the controls are hidden (the PC restarts its conversion at the new position on its own);
     * with the controls on screen they move between the buttons.
     */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN && !view.isControllerFullyVisible) {
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
        if (hls && event.action == KeyEvent.ACTION_DOWN &&
            (event.keyCode == KeyEvent.KEYCODE_MENU || event.keyCode == KeyEvent.KEYCODE_MEDIA_AUDIO_TRACK)
        ) {
            showPcChoices()
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    private fun seekBy(deltaMs: Long) {
        val total = player.duration.takeIf { it != C.TIME_UNSET } ?: request.optLong("durationMs", -1)
        val target = (player.currentPosition + deltaMs).coerceAtLeast(0)
        player.seekTo(if (total > 0) target.coerceAtMost(total - 1_000) else target)
    }

    private fun list(name: String) = request.optJSONArray(name).let { a ->
        (0 until (a?.length() ?: 0)).map { a!!.getJSONObject(it) }
    }

    /** What only the PC can change in an HLS stream: the audio track and burned-in (image) subtitles. */
    private fun pcChoices(): List<Pair<String, () -> Unit>> {
        val audio = list("audioTracks")
        val subs = list("subtitleTracks")
        val burned = subs.firstOrNull { it.optBoolean("burnedIn") }
        val choices = mutableListOf<Pair<String, () -> Unit>>()
        if (audio.size > 1)
            for (a in audio)
                choices += "Audio: ${a.optString("label")}${if (a.optBoolean("selected")) "  ✓" else ""}" to {
                    if (!a.optBoolean("selected")) restart(a.optInt("index"), burned?.optString("id"))
                }
        for (sub in subs.filter { it.optString("kind") == "embedded-image" })
            choices += "Subtitles in the picture: ${sub.optString("label")}${if (sub.optBoolean("burnedIn")) "  ✓" else ""}" to {
                if (!sub.optBoolean("burnedIn")) restart(selectedAudio(), sub.optString("id"))
            }
        if (burned != null) choices += "Subtitles in the picture: off" to { restart(selectedAudio(), null) }
        return choices
    }

    private fun selectedAudio(): Int? = list("audioTracks").firstOrNull { it.optBoolean("selected") }?.optInt("index")

    private fun showPcChoices() {
        val choices = pcChoices()
        if (choices.isEmpty()) return
        AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle("Audio & subtitles")
            .setItems(choices.map { it.first }.toTypedArray()) { _, which -> choices[which].second() }
            .show()
    }

    /** A new stream from the PC at the current position, with another audio track or burned-in subtitles. */
    private fun restart(audioIndex: Int?, subtitleId: String?) {
        if (closed) return
        closed = true
        val event = JSONObject()
            .put("type", "restart")
            .put("itemId", request.optString("itemId"))
            .put("positionMs", player.currentPosition.coerceAtLeast(0))
            .put("audioIndex", audioIndex ?: JSONObject.NULL)
            .put("subtitleId", subtitleId ?: JSONObject.NULL)
        setResult(Activity.RESULT_OK, Intent().putExtra(EXTRA_EVENT, event.toString()))
        finish()
    }

    private var closed = false
    private fun close(ended: Boolean) {
        if (closed) return
        closed = true
        val duration = request.optLong("durationMs", -1).takeIf { it > 0 }
            ?: player.duration.takeIf { it != C.TIME_UNSET }
        val event = JSONObject()
            .put("type", "closed")
            .put("itemId", request.optString("itemId"))
            .put("positionMs", player.currentPosition.coerceAtLeast(0))
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
