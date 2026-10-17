package com.jakubkonkol.adrenaline.tv

import android.content.Context
import android.os.Build
import android.provider.Settings
import android.webkit.JavascriptInterface

/** `window.AdrenalineNative` for the TV web app (see src/tv/env.d.ts). Only plain values cross the bridge. */
class AdrenalineBridge(private val activity: MainActivity) {
    private val prefs = activity.getSharedPreferences("adrenaline", Context.MODE_PRIVATE)

    /**
     * Durable storage for the web app (its connection to the PC): WebView writes localStorage lazily and loses it when
     * the TV stops the app soon after pairing. Only the app's own keys, written synchronously.
     */
    @JavascriptInterface
    fun getValue(key: String): String = if (key.startsWith(PREFIX)) prefs.getString(key, null) ?: "" else ""

    @JavascriptInterface
    fun setValue(key: String, value: String) {
        if (key.startsWith(PREFIX) && value.length <= 16_384) prefs.edit().putString(key, value).commit()
    }

    @JavascriptInterface
    fun removeValue(key: String) {
        if (key.startsWith(PREFIX)) prefs.edit().remove(key).commit()
    }

    @JavascriptInterface
    fun deviceName(): String =
        (Settings.Global.getString(activity.contentResolver, Settings.Global.DEVICE_NAME) ?: Build.MODEL ?: "Android TV")
            .take(60)

    @JavascriptInterface
    fun serverUrl(): String = activity.serverUrl()

    @JavascriptInterface
    fun installMarker(): String = activity.installMarker()

    @JavascriptInterface
    fun play(request: String) = activity.play(request)

    @JavascriptInterface
    fun exit() = activity.runOnUiThread { activity.finish() }

    /** What this TV plays (D-85): codecs, HDR, audio passthrough. */
    @JavascriptInterface
    fun deviceProfile(): String = DeviceCapabilities.profile(activity).toString()

    private companion object {
        const val PREFIX = "adrenaline."
    }
}
