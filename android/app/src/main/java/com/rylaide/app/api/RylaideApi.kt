// Copyright (c) 2026 Shubhan Punde · https://github.com/Drakeion2532/rylaide_ui · All rights reserved · sp2532-ce395384fbda
package com.rylaide.app.api

import android.os.Handler
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Kotlin client for the Rylaide API (docs: <server>/api/docs, spec: <server>/api/v1/openapi.json).
 * No extra libraries: HttpURLConnection + org.json from the Android SDK.
 *
 * Blocking calls (`me()`, `vehicles()`, …) must run off the main thread. From UI code use `call { … }`:
 *
 *     val api = RylaideApi(BuildConfig.SERVER_URL, token = prefs.getString("token", null))
 *     api.call({ it.vehicles() }) { result -> result.onSuccess { json -> … }.onFailure { e -> … } }
 *
 * The web app inside MainActivity keeps its own sign-in; to share it, read the token from the WebView with
 * `web.evaluateJavascript("localStorage.getItem('rylaide.token')")` (it is JSON-encoded) and pass it here.
 */
class RylaideApi(baseUrl: String, @Volatile var token: String? = null) {
    private val base = baseUrl.trimEnd('/') + "/api/v1"
    private val main = Handler(Looper.getMainLooper())

    class ApiException(val status: Int, message: String) : IOException(message)

    // ------------------------------------------------------------ plumbing
    fun request(method: String, path: String, body: JSONObject? = null, auth: Boolean = true): JSONObject {
        val conn = (URL(base + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 15_000
            readTimeout = 30_000
            setRequestProperty("Accept", "application/json")
            if (auth) token?.let { setRequestProperty("Authorization", "Bearer $it") }
            if (body != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
            }
        }
        try {
            if (body != null) conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            val json = if (text.isBlank()) JSONObject() else try { JSONObject(text) } catch (e: Exception) { JSONObject().put("raw", text) }
            if (code !in 200..299) throw ApiException(code, json.optString("error", "Request failed ($code)"))
            return json
        } finally {
            conn.disconnect()
        }
    }

    private fun get(path: String, auth: Boolean = true) = request("GET", path, null, auth)
    private fun post(path: String, body: JSONObject = JSONObject(), auth: Boolean = true) = request("POST", path, body, auth)
    private fun patch(path: String, body: JSONObject) = request("PATCH", path, body)
    private fun put(path: String, body: JSONObject) = request("PUT", path, body)
    private fun delete(path: String, body: JSONObject? = null) = request("DELETE", path, body)
    private fun q(s: String) = URLEncoder.encode(s, "UTF-8")
    private fun obj(vararg pairs: Pair<String, Any?>) = JSONObject().apply { for ((k, v) in pairs) if (v != null) put(k, v) }

    /** Run a blocking call on a background thread and get the result on the main thread. */
    fun <T> call(block: (RylaideApi) -> T, done: (Result<T>) -> Unit) {
        pool.execute {
            val r = runCatching { block(this) }
            main.post { done(r) }
        }
    }

    // ------------------------------------------------------------ account
    /** 06 Create account. Stores the returned token on this client. */
    fun createAccount(name: String, agreed: Boolean = true): JSONObject =
        post("/users", obj("name" to name, "agreed" to agreed), auth = false).also { token = it.optString("token").ifEmpty { null } }
    /** 05 Sign in with the account code from another phone. */
    fun signIn(code: String): JSONObject = post("/signin", obj("code" to code), auth = false).also { token = it.optString("token").ifEmpty { null } }
    fun me(): JSONObject = get("/me").getJSONObject("user")
    fun updateMe(name: String? = null, color: String? = null): JSONObject = patch("/me", obj("name" to name, "color" to color)).getJSONObject("user")
    fun accountCode(): String = get("/me/account").getString("code")
    fun config(): JSONObject = get("/config", auth = false)
    fun reportProblem(topic: String, message: String, contact: String? = null, info: String? = null): String =
        post("/support", obj("topic" to topic, "message" to message, "contact" to contact, "info" to info), auth = false).getString("ref")

    // ------------------------------------------------------------ garage
    fun vehicles(): JSONObject = get("/vehicles")
    fun addVehicle(make: String, model: String, type: String? = null, odometer: Int? = null, year: Int? = null, reg: String? = null, nickname: String? = null): JSONObject =
        post("/vehicles", obj("make" to make, "model" to model, "type" to type, "odometer" to odometer, "year" to year, "reg" to reg, "nickname" to nickname))
    fun editVehicle(id: String, changes: JSONObject): JSONObject = patch("/vehicles/$id", changes)
    fun deleteVehicle(id: String): JSONObject = delete("/vehicles/$id")
    /** Ride this vehicle: shown on Home; rides and fuel go to it. */
    fun setActiveVehicle(id: String): JSONObject = post("/vehicles/$id/active")
    fun uploadVehiclePhoto(id: String, jpegBase64: String): JSONObject = post("/vehicles/$id/photo", obj("data" to jpegBase64))
    fun service(vehicleId: String): JSONObject = get("/vehicles/$vehicleId/service")
    fun addService(vehicleId: String, type: String, date: String? = null, odometer: Int? = null, cost: Double? = null, nextKm: Int? = null, nextDate: String? = null, note: String? = null): JSONObject =
        post("/vehicles/$vehicleId/service", obj("type" to type, "date" to date, "odometer" to odometer, "cost" to cost, "nextKm" to nextKm, "nextDate" to nextDate, "note" to note))
    fun fuel(vehicleId: String? = null): JSONObject = get("/fuel" + (vehicleId?.let { "?vehicle=${q(it)}" } ?: ""))
    fun addFuel(vehicleId: String?, odometer: Double, litres: Double, pricePerLitre: Double, full: Boolean = true): JSONObject =
        post("/fuel", obj("vehicleId" to vehicleId, "odometer" to odometer, "litres" to litres, "pricePerLitre" to pricePerLitre, "full" to full))

    // ------------------------------------------------------------ safety
    fun contacts(): JSONArray = get("/contacts").getJSONArray("contacts")
    fun saveContacts(contacts: JSONArray): JSONArray = put("/contacts", obj("contacts" to contacts)).getJSONArray("contacts")

    // ------------------------------------------------------------ groups
    fun groups(): JSONArray = get("/groups").getJSONArray("groups")
    fun group(id: String): JSONObject = get("/groups/$id").getJSONObject("group")
    fun createGroup(name: String): JSONObject = post("/groups", obj("name" to name)).getJSONObject("group")
    fun joinGroup(code: String): JSONObject = post("/groups/join", obj("code" to code)).getJSONObject("group")
    fun leaveGroup(id: String): JSONObject = post("/groups/$id/leave")
    fun messages(groupId: String): JSONArray = get("/groups/$groupId/messages").getJSONArray("messages")
    fun groupRides(groupId: String): JSONArray = get("/groups/$groupId/rides").getJSONArray("rides")
    /** 17 Select riders: start a live ride; picked riders get a ride_live invite. */
    fun startGroupRide(groupId: String, riders: List<String>, destination: String? = null, lat: Double? = null, lng: Double? = null): JSONObject =
        post("/groups/$groupId/ride", obj("riders" to JSONArray(riders), "destination" to destination, "lat" to lat, "lng" to lng))
    fun endGroupRide(groupId: String): JSONObject = delete("/groups/$groupId/ride")
    fun expenses(groupId: String): JSONObject = get("/groups/$groupId/expenses")
    fun addExpense(groupId: String, title: String, amount: Double, paidBy: String? = null, split: List<String>? = null): JSONObject =
        post("/groups/$groupId/expenses", obj("title" to title, "amount" to amount, "paidBy" to paidBy, "split" to split?.let { JSONArray(it) }))
    fun sharedPlaces(groupId: String): JSONArray = get("/groups/$groupId/shared").getJSONArray("shared")
    fun sharePlace(groupId: String, name: String, lat: Double, lng: Double, kind: String = "other", note: String? = null): JSONObject =
        post("/groups/$groupId/shared", obj("name" to name, "lat" to lat, "lng" to lng, "kind" to kind, "note" to note))
    fun nearby(lat: Double, lng: Double): JSONObject = post("/nearby", obj("lat" to lat, "lng" to lng))

    // ------------------------------------------------------------ rides
    fun rides(): JSONArray = get("/rides").getJSONArray("rides")
    fun ride(id: String): JSONObject = get("/rides/$id").getJSONObject("ride")
    /** points: [lat, lng, timestampMs] triples. */
    fun saveRide(points: JSONArray, durationSec: Double, maxSpeedMps: Double, startedAt: Long, destination: String? = null,
                 groupId: String? = null, vehicleId: String? = null, pillion: Boolean = false, quick: Boolean = false): JSONObject =
        post("/rides", obj("points" to points, "duration" to durationSec, "maxSpeed" to maxSpeedMps, "startedAt" to startedAt, "destination" to destination,
            "groupId" to groupId, "vehicleId" to vehicleId, "pillion" to pillion, "quick" to quick)).getJSONObject("ride")

    // ------------------------------------------------------------ maps
    fun route(fromLat: Double, fromLng: Double, toLat: Double, toLng: Double): JSONObject = get("/route?from=$fromLng,$fromLat&to=$toLng,$toLat")
    fun search(query: String, nearLat: Double? = null, nearLng: Double? = null): JSONArray =
        get("/search?q=${q(query)}" + (if (nearLat != null && nearLng != null) "&near=$nearLng,$nearLat" else "")).getJSONArray("results")
    fun reverse(lat: Double, lng: Double): JSONObject = get("/reverse?lat=$lat&lng=$lng")
    fun weather(lat: Double, lng: Double): JSONObject = get("/weather?lat=$lat&lng=$lng")

    /** WebSocket address for realtime (see /api/docs → Realtime). */
    fun realtimeUrl(): String = base.removeSuffix("/api/v1").replaceFirst("http", "ws") + "/ws?token=" + q(token ?: "")

    companion object {
        private val pool: ExecutorService = Executors.newFixedThreadPool(3)
    }
}
