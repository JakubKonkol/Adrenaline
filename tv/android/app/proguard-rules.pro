# Methods called from JavaScript (WebView bridge) must keep their names.
-keepclassmembers class com.jakubkonkol.adrenaline.tv.AdrenalineBridge {
    @android.webkit.JavascriptInterface <methods>;
}
