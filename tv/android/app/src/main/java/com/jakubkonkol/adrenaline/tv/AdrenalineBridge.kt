package com.jakubkonkol.adrenaline.tv

import android.os.Build
import android.provider.Settings
import android.webkit.JavascriptInterface

/** `window.AdrenalineNative` for the TV web app (see src/tv/env.d.ts). Only plain values cross the bridge. */
class AdrenalineBridge(private val activity: MainActivity) {
    @JavascriptInterface
    fun deviceName(): String =
        (Settings.Global.getString(activity.contentResolver, Settings.Global.DEVICE_NAME) ?: Build.MODEL ?: "Android TV")
            .take(60)

    @JavascriptInterface
    fun serverUrl(): String = activity.serverUrl()

    @JavascriptInterface
    fun play(request: String) = activity.play(request)

    @JavascriptInterface
    fun exit() = activity.runOnUiThread { activity.finish() }

    /** What this TV plays (D-85): codecs, HDR, audio passthrough. */
    @JavascriptInterface
    fun deviceProfile(): String = DeviceCapabilities.profile(activity).toString()
}
