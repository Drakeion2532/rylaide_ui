# Keep the JavaScript bridge methods called from the web app.
-keepclassmembers class com.rylaide.app.RylaideBridge {
    @android.webkit.JavascriptInterface <methods>;
}
