package com.jakubkonkol.adrenaline.tv

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import org.json.JSONObject

/**
 * Adrenaline on Android TV (D-81): the shared TV web app runs in a WebView from the APK's assets; video plays in the
 * native Media3 activity. The PC address can come from Deploy to TV (`adb shell am start … --es server http://…`).
 */
class MainActivity : ComponentActivity() {
    private lateinit var web: WebView

    private val player = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val event = result.data?.getStringExtra(PlayerActivity.EXTRA_EVENT)
        if (result.resultCode == Activity.RESULT_OK && event != null) {
            // JSON from our own activity, passed as a JS string literal.
            web.evaluateJavascript(
                "window.__adrenalineNativeEvent && window.__adrenalineNativeEvent(${JSONObject.quote(event)})",
                null,
            )
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        rememberServer(intent)
        web = WebView(this).apply {
            setBackgroundColor(0xFF08090B.toInt())
            isFocusable = true
            isFocusableInTouchMode = true
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.allowContentAccess = false
            settings.setSupportZoom(false)
            // Only the bundled app: any other navigation (a link in a description…) is refused.
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) =
                    !request.url.toString().startsWith(APP_ROOT)
            }
            addJavascriptInterface(AdrenalineBridge(this@MainActivity), "AdrenalineNative")
        }
        setContentView(web)
        web.systemUiVisibility = View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
        web.loadUrl("${APP_ROOT}index.html")
        web.requestFocus()

        // The Back button goes to the web app first (dialogs, screens); it leaves only from the root screen.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                web.evaluateJavascript("window.__adrenalineBack ? window.__adrenalineBack() : false") { handled ->
                    if (handled != "true") finish()
                }
            }
        })
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        rememberServer(intent)
    }

    private fun rememberServer(intent: Intent?) {
        val server = intent?.getStringExtra(EXTRA_SERVER) ?: return
        if (Regex("""^https?://[0-9A-Za-z.\-]+:\d{2,5}$""").matches(server)) {
            getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(EXTRA_SERVER, server).apply()
        }
    }

    fun serverUrl(): String = getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(EXTRA_SERVER, "") ?: ""

    fun play(request: String) = runOnUiThread {
        player.launch(Intent(this, PlayerActivity::class.java).putExtra(PlayerActivity.EXTRA_REQUEST, request))
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }

    companion object {
        const val APP_ROOT = "file:///android_asset/tv/"
        const val EXTRA_SERVER = "server"
        private const val PREFS = "adrenaline"
    }
}
