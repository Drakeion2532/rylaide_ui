package com.rylaide.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Rylaide for Android: a full-screen WebView around the Rylaide web app (served by `npm start`),
 * plus a small native bridge (window.RylaideAndroid) for voice prompts, vibration, sharing and
 * keeping the screen on during a ride.
 */
class MainActivity : Activity() {

    private lateinit var root: FrameLayout
    lateinit var web: WebView
        private set
    private var setupView: View? = null
    private lateinit var bridge: RylaideBridge

    // Pending web permission requests, answered after the Android runtime prompt
    private var pendingGeo: Pair<String, GeolocationPermissions.Callback>? = null
    private var pendingMedia: PermissionRequest? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    private val prefs by lazy { getSharedPreferences("rylaide", MODE_PRIVATE) }

    var serverUrl: String
        get() = prefs.getString("server", null)?.takeIf { it.isNotBlank() } ?: BuildConfig.SERVER_URL
        set(v) { prefs.edit().putString("server", v.trim().trimEnd('/')).apply() }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val debuggable = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        WebView.setWebContentsDebuggingEnabled(debuggable) // chrome://inspect on your computer

        root = FrameLayout(this)
        root.setBackgroundColor(Color.parseColor("#FAF9FD"))
        web = WebView(this)
        root.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(root)

        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            setGeolocationEnabled(true)
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
            allowFileAccess = false
            setSupportZoom(false)
            builtInZoomControls = false
            userAgentString = "$userAgentString RylaideAndroid/${BuildConfig.VERSION_NAME}"
        }
        bridge = RylaideBridge(this)
        web.addJavascriptInterface(bridge, "RylaideAndroid")
        web.webViewClient = Client()
        web.webChromeClient = Chrome()

        if (savedInstanceState != null) web.restoreState(savedInstanceState)
        else load(intent)
    }

    private fun load(i: Intent?) {
        hideSetup()
        val base = serverUrl
        // rylaide://join/ABC123 → /?join=ABC123
        val code = i?.data?.takeIf { it.scheme == "rylaide" }?.lastPathSegment
        web.loadUrl(if (code != null) "$base/?join=${Uri.encode(code)}" else "$base/")
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        if (intent?.data != null) load(intent)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onResume() { super.onResume(); web.onResume() }
    override fun onPause() { web.onPause(); super.onPause() }

    override fun onDestroy() {
        bridge.shutdown()
        web.destroy()
        super.onDestroy()
    }

    @Deprecated("Framework back handling; works on every API level we support")
    override fun onBackPressed() {
        if (setupView != null && web.url != null) { hideSetup(); return }
        // The web app keeps its own history (pushState), so WebView back walks the in-app screens.
        if (web.canGoBack()) web.goBack() else @Suppress("DEPRECATION") super.onBackPressed()
    }

    fun keepAwake(on: Boolean) = runOnUiThread {
        if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    // ---------------------------------------------------------------- server setup screen

    /** Shown when the server can't be reached, or from Settings → App server. */
    fun showSetup(error: String?) = runOnUiThread {
        hideSetup()
        val dp = resources.displayMetrics.density
        val pad = (24 * dp).toInt()
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(pad, pad, pad, pad)
            setBackgroundColor(Color.parseColor("#FAF9FD"))
            isClickable = true
        }
        fun text(s: String, size: Float, color: String, bold: Boolean = false) = TextView(this).apply {
            text = s; textSize = size; setTextColor(Color.parseColor(color))
            if (bold) typeface = android.graphics.Typeface.DEFAULT_BOLD
            setPadding(0, 0, 0, (12 * dp).toInt())
        }
        box.addView(text("Connect to Rylaide", 26f, "#1A1C1E", true))
        box.addView(text(
            if (error != null) "Couldn’t reach the Rylaide server.\n$error" else "Where the Rylaide server is running.",
            16f, if (error != null) "#BA1A1A" else "#43474E"))
        box.addView(text(
            "Phone on USB: run  npm start  on your computer, then  adb reverse tcp:3000 tcp:3000  and use http://localhost:3000.\n\n" +
            "Hosted server: use its https:// address.", 14f, "#43474E"))
        val input = EditText(this).apply {
            setText(serverUrl)
            setSingleLine()
            inputType = EditorInfo.TYPE_CLASS_TEXT or EditorInfo.TYPE_TEXT_VARIATION_URI
            imeOptions = EditorInfo.IME_ACTION_GO
            setTextColor(Color.parseColor("#1A1C1E"))
        }
        box.addView(input)
        val connect = Button(this).apply {
            text = "Connect"
            setOnClickListener {
                var v = input.text.toString().trim()
                if (v.isEmpty()) v = BuildConfig.SERVER_URL
                if (!v.startsWith("http://") && !v.startsWith("https://")) v = "http://$v"
                serverUrl = v
                load(null)
            }
        }
        input.setOnEditorActionListener { _, id, _ -> if (id == EditorInfo.IME_ACTION_GO) { connect.performClick(); true } else false }
        box.addView(connect, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = (16 * dp).toInt() })
        if (BuildConfig.SERVER_URL != serverUrl) {
            box.addView(Button(this).apply {
                text = "Reset to ${BuildConfig.SERVER_URL}"
                setOnClickListener { prefs.edit().remove("server").apply(); load(null) }
            })
        }
        setupView = box
        root.addView(box, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    }

    private fun hideSetup() {
        setupView?.let { root.removeView(it) }
        setupView = null
    }

    // ---------------------------------------------------------------- web clients

    private inner class Client : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
            val uri = req.url
            val scheme = uri.scheme ?: return false
            if (scheme == "http" || scheme == "https") {
                val ours = Uri.parse(serverUrl)
                if (uri.host == ours.host && uri.port == ours.port) return false
                return openExternal(Intent(Intent.ACTION_VIEW, uri)) // maps, links → the phone's apps
            }
            val i = if (scheme == "intent") {
                try { Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME) } catch (e: Exception) { return true }
            } else Intent(Intent.ACTION_VIEW, uri) // tel:, sms:, mailto:, geo:
            return openExternal(i)
        }

        override fun onReceivedError(view: WebView, req: WebResourceRequest, err: WebResourceError) {
            if (req.isForMainFrame) showSetup("${err.description} (${serverUrl})")
        }

        override fun onPageFinished(view: WebView, url: String?) {
            if (url != null && !url.startsWith("about:")) root.setBackgroundColor(Color.TRANSPARENT)
        }
    }

    private fun openExternal(i: Intent): Boolean {
        try { startActivity(i.addCategory(Intent.CATEGORY_BROWSABLE).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        catch (e: ActivityNotFoundException) { /* no app for it */ }
        catch (e: SecurityException) { /* not exported */ }
        return true
    }

    private inner class Chrome : WebChromeClient() {
        override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
            if (has(Manifest.permission.ACCESS_FINE_LOCATION) || has(Manifest.permission.ACCESS_COARSE_LOCATION)) {
                callback.invoke(origin, true, false)
            } else {
                pendingGeo = origin to callback
                requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), REQ_LOCATION)
            }
        }

        override fun onPermissionRequest(request: PermissionRequest) {
            runOnUiThread {
                val wantsMic = request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)
                if (!wantsMic) { request.deny(); return@runOnUiThread }
                if (has(Manifest.permission.RECORD_AUDIO)) request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
                else {
                    pendingMedia = request
                    requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_MIC)
                }
            }
        }

        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            fileCallback?.onReceiveValue(null)
            fileCallback = callback
            return try {
                startActivityForResult(params.createIntent(), REQ_FILE)
                true
            } catch (e: ActivityNotFoundException) {
                fileCallback = null
                callback.onReceiveValue(null)
                false
            }
        }
    }

    @Deprecated("Framework Activity result API")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == REQ_FILE) {
            fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
            fileCallback = null
            return
        }
        @Suppress("DEPRECATION") super.onActivityResult(requestCode, resultCode, data)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        val ok = grantResults.any { it == PackageManager.PERMISSION_GRANTED }
        when (requestCode) {
            REQ_LOCATION -> {
                pendingGeo?.let { (origin, cb) -> cb.invoke(origin, ok, false) }
                pendingGeo = null
                if (!ok) explainDenied("Location")
            }
            REQ_MIC -> {
                pendingMedia?.let { if (ok) it.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) else it.deny() }
                pendingMedia = null
                if (!ok) explainDenied("Microphone")
            }
        }
    }

    private fun explainDenied(what: String) {
        // Android stops asking after two denials; offer the shortcut to app settings.
        AlertDialog.Builder(this)
            .setTitle("$what is off")
            .setMessage("Rylaide needs ${what.lowercase()} access for rides. You can turn it on in the app’s settings.")
            .setPositiveButton("Open settings") { _, _ ->
                openExternal(Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
            }
            .setNegativeButton("Not now", null)
            .show()
    }

    private fun has(p: String) = checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED

    companion object {
        private const val REQ_LOCATION = 11
        private const val REQ_MIC = 12
        private const val REQ_FILE = 13
    }
}
