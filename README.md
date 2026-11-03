# Rylaide (prototype)

A riding companion for riders and riding groups: motorcycles, scooters, EVs and bicycles. Run it as an Android app
from Android Studio (below), or install it on any phone from a link.

The UI is built from the Figma file **Rylaide** (`01 — Foundations`, `02 — Components`): Material 3 colour roles,
Google Sans Flex + Roboto, Material Symbols Rounded, Day / Evening / Night themes, the 8 rider accents,
Glove Mode (64 → 80 dp ride controls) and the motion rules (300 ms forward slide, 200 ms tab fade-through,
hold-to-confirm rings on SOS and talk). Screens follow the Figma navigation map: four tabs
(Home · Groups · History · Garage), a 5-step ride setup (how you’re riding → who’s riding → checklist → where to → route), the ride hub (Map · Speed · Group), full-screen map,
SOS countdown and ride summary.

**What riders can do**
- Add your vehicle: type make and model (about 150 Indian motorcycles, scooters, EVs and bicycles suggested as you type) and Rylaide works out the type, or pick it. Add a photo of your own bike and it becomes the Home picture; otherwise Home shows a picture that matches your type
- Choose **Solo ride** (with or without a pillion), **Group ride** (pick your group, see who’s ready, check your mic) or **Quick ride** (skip setup) before every ride. Solo rides keep your location private
- Create a group, or join one with a 6-letter code, invite link or QR
- See every rider live on the map, with heading, distance away and online status
- **Hands-free group voice:** on a group ride the mic is open and you just talk; nothing is sent while you're quiet. One tap mutes or unmutes (remembered for next time). In the Android app it keeps working **offline between nearby riders** over Bluetooth, phone to phone, and with the screen off
- Group chat, with join, leave and plan notices
- Search a destination, see the route, and get turn-by-turn directions spoken in your headset (reroutes if you go off course)
- Share a ride plan (destination, meet time, note) with the group
- Record rides: live speed, distance and time; saved to ride history
- SOS: hold 1.5 s, then a 5 s countdown you can cancel. The group gets an alert with your location, and you get call and text buttons for your emergency contacts and 112
- Pre-ride checklist that adapts to your bike, trip length, time of day and the weather
- Fuel log with full-tank mileage (km/l), spend and a trend chart
- Mic test with a live level meter, record and playback
- Auto Day / Evening / Night from sunrise and sunset (or fixed Light / Dark), 8 accent colours, Glove Mode, spoken directions on/off
- Works offline for the app shell and recently seen map areas; reconnects automatically
- **Garage:** keep several vehicles, pick which one you're riding (it shows on Home), per-vehicle fuel log, a service & documents log (oil, chain, tyres, insurance, PUC) with reminders before things are due
- **Groups:** Chat · Rides · Members · Shared tabs; group info; leader tools (rename, remove a rider, hand over, new code, delete); split expenses with who-owes-whom; shared places (meet points, fuel, dhabas); make a group with riders nearby, no code
- **Ride:** pick who's riding today (they get a "… started a ride · Join" invite), choose a destination by dropping a pin, a Pillion tab with break reminders, crash detection (30 s countdown, then SOS), and an Arrived screen
- **Account:** Terms & privacy before you start, sign in on another phone with your account code, delete account
- **Settings:** Account, Appearance, Riding & directions, Safety & SOS, Location & privacy, Audio & headset, Offline & storage, About, and Customer care with the Rylaide Assistant (guided fixes, then a report straight to Rylaide support)
- **Voice:** open mic with a voice detector (sends only while you speak, learns wind and engine noise; sensitivity Low/Normal/High), 20 ms Opus frames at 24 kbps, 60 ms jitter buffer, riders mixed so two can talk at once (about 0.2 s mouth-to-ear online). Noise cancellation: wind filter + RNNoise (AI noise removal) + compressor in the browser; the phone's echo cancel and noise suppression in the Android app
- **Offline voice (Android app, iPhone app to follow):** nearby riders' phones link over Bluetooth LE and relay each other's voice (3 hops); a rider with signal carries offline riders' voice to the rest of the group and back. Same packet on every link and platform: see [docs/offline-voice.md](docs/offline-voice.md)
- **Smartwatch (Android app):** turns, arrival, breaks and group SOS appear on any watch that shows the phone's notifications (Noise, Fire-Boltt, boAt, Amazfit, Wear OS…). Settings → Riding & directions → Show on my watch. **Ride on the watch's music screen:** the next turn, speed and voice state show where the song title would be; the watch's play/pause mutes the mic and next/previous changes the page, so the watch can sit on the handlebar with the phone in a pocket (the app keeps GPS running with the screen off). A watch's mic and speaker are never used
- **Voice guidance button on the map** (like Google Maps): Sound on · Alerts only · Muted
- **Map turns with you** (compass button on the map, on by default): the way you face is up. Phone compass while stopped, GPS direction while moving (more reliable on a bike); one tap for north up
- **Sound comes from** the helmet headset (default) or the phone speaker for car rides, which uses the phone's own mic. A smartwatch's mic and speaker are never used, even when it's connected for calls

**Screen flow** follows the Figma *Navigation map · for development*:
- Account: 01 → 02–04 → 04b Before you start → 05 Sign in or 06 Create account → 07 Setup → 07a Bikes (several) · 07b Permissions → 08 Home
- Ride: 13 Start ride (pick the bike; Solo · Group · Quick) → group 15 My groups / 16 Nearby → 17 Select riders → 18 Ready → 19 Conditions (pillion) → 20 Checklist → 21 Headset → 22 Where to / 22e Pin → 23 Place → 24 Routes → 25t/25u/25r hub; Quick → 25q (Map · Speed, refills) → 34q
- In the hub: 25 full-screen map, 29 full-screen speedometer, 28 full-screen group; End ride → 33 / 32 Arrived → 34 Summary → Home
- Groups: 38 → 40 New group → invite → G01 (Chat · Rides · Members · Shared) → 39 Info → 41 Members · 39c Expenses · G14 Settings
- Garage: 12 My vehicles → 11 Vehicle → 11d Fuel · 11e/11f Add/Edit · 11j Service. Settings: 08 → 43 → 44–58
- Each bottom tab remembers where you were; tapping the tab you're on goes back to its first screen

**Support email:** none yet. Set `SUPPORT_EMAIL` on the server when the Rylaide address exists; until then reports are stored on the server (read them with `GET /api/admin/reports` and header `x-admin-key: <ADMIN_KEY>`).

## Run it locally

```bash
npm install
npm start                # http://localhost:3000
```

Location and microphone only work on `localhost` or HTTPS. To try it on your phone, deploy it (below) or use a tunnel such as `cloudflared tunnel --url http://localhost:3000`.

## Run it on your Android phone (Android Studio)

The `android/` folder is an Android Studio project: a native shell (WebView) around this app, with Android’s own
speech for directions, vibration for alerts, the share sheet, the camera/gallery picker for your bike photo, and
the screen kept on during rides. It needs no extra libraries.

1. **Start the server** on your computer: `npm install && npm start` (port 3000).
2. **Open** Android Studio → *Open* → choose the `android` folder (not the repo root). Let Gradle sync
   (first time downloads Gradle 8.10 and the Android plugin; JDK 17 is bundled with Android Studio).
3. **Connect your phone** with USB, with *Developer options → USB debugging* on.
4. **Point the phone at your computer:**
   ```bash
   adb reverse tcp:3000 tcp:3000
   ```
   Now `http://localhost:3000` on the phone is your computer’s server. This matters: GPS and the mic only work on
   `localhost` or `https`. Run it again whenever you reconnect the cable. (Emulator: same command.)
5. **Run ▶** `app`. Allow Location and Microphone when asked.

**Server address.** The app loads from `https://rylaide.onrender.com` by default (`rylaideServerUrl` in
`android/gradle.properties`), so it works anywhere with mobile data and steps 1 and 4 are only needed to test
local changes (set it to `http://localhost:3000`).

**Install without a cable / share with friends:** *Build → Generate App Bundles or APKs → Generate APKs*, then
*locate* `app-debug.apk` (in `android/app/build/outputs/apk/debug/`). Send it over WhatsApp or Drive; on the phone,
open it and allow *Install unknown apps*. You can also change it
in the app: *Settings → App server*, or the connect screen that shows when the server can’t be reached.

**Debugging:** with the phone connected, open `chrome://inspect` in Chrome on your computer to see the app’s console.

> The Kotlin code is type-checked against the Android 34 API, but this environment can’t download the Android SDK,
> so the first full Gradle build happens in your Android Studio. If it reports anything, send the message over.

## API for the app

Everything the app does goes through a documented API you can call from Kotlin:

- **Docs:** `https://rylaide.onrender.com/api/docs` (or `http://localhost:3000/api/docs`)
- **Spec:** `/api/v1/openapi.json` (OpenAPI 3, import into Postman or Android Studio's HTTP client)
- **Kotlin client:** `android/app/src/main/java/com/rylaide/app/api/RylaideApi.kt`, no extra libraries:

```kotlin
val api = RylaideApi(BuildConfig.SERVER_URL)
api.call({ it.signIn("K7QM-4XPA"); it.vehicles() }) { result ->
    result.onSuccess { garage -> /* garage.getJSONArray("vehicles") */ }
          .onFailure { e -> /* show e.message */ }
}
```

- **Realtime** (location, chat, SOS, live voice) is a WebSocket at `/ws?token=…`; the message format is in the docs. Live voice is binary RVP packets, the same ones the Android app sends phone to phone offline: [docs/offline-voice.md](docs/offline-voice.md).
- **Group voice in the Android app** runs natively (`voice/`: `VoiceEngine.kt` mic + Opus + mixing, `BleMesh.kt` offline Bluetooth link, `VoiceHub.kt` routing, `RideVoiceService.kt` screen-off running). The web app starts it through `window.RylaideAndroid.voiceStart(…)`. Needs Android 10+; older phones use the web voice.

## Tests

```bash
npm test                 # 27 backend tests (+2 database tests with TEST_DATABASE_URL set): accounts, bike + photo, groups, chat, voice, SOS, rides, fuel, map services, limits, restarts
npm run test:e2e         # 21 browser flows with two riders, fake mic and GPS (needs Python + Playwright)
npm run test:all
```

Map, routing, search and weather are faked in tests, so they run without internet.

## Icons

The app ships a 13 KB subset of Material Symbols Rounded with only the icons it uses. After adding an icon
(`ic('icon_name')` anywhere in `web/js`), rebuild it:

```bash
pip install fonttools brotli
npm run build:icons
```

## Photos

`web/img/` holds the bike, group and road photos from the Figma *Imagery library (Unsplash, free licence)*.
They are the library's 240 px thumbnails, so the Home hero looks soft on big screens. To swap in full-size
photos, replace the JPEGs with the originals (same names, about 1200 px wide).

Which picture Home shows: the rider’s own photo if they added one; otherwise the picture for their vehicle type
(`classic`, `roadster`, `cruiser`, `adventure`, `sport`, `commuter` use the photos; `scooter`, `ev-scooter`,
`bicycle`, `e-bike` use drawn artwork). The type comes from the catalogue in `web/js/vehicles.js`
(make + model → type), then keyword rules, so add models there. Uploaded photos are stored in `PHOTO_DIR`
(default: a `photos` folder next to the data file).

## Deploy for free (Render + Neon, about 15 minutes)

Everything here is on free plans with no card: **Render** runs the server, **Neon** stores the data.
Render's free servers lose their disk on every restart, so accounts, groups, rides and bike photos are kept
in the Neon database instead (`DATABASE_URL`).

**1. Database (Neon)**
1. Sign up at [neon.tech](https://neon.tech) (GitHub sign-in works). Create a project named `rylaide`,
   region **AWS Asia Pacific (Singapore)**.
2. On the project dashboard, click **Connect** and copy the connection string. It looks like
   `postgresql://neondb_owner:…@ep-…ap-southeast-1.aws.neon.tech/neondb?sslmode=require`.
   Keep it private: it's the password to your data. The app creates its tables by itself.

**2. Server (Render)**
1. Sign up at [render.com](https://render.com) with GitHub. **New → Blueprint** → pick `rylaide_ui`.
   It reads `render.yaml` (free plan, Singapore).
2. When it asks for the variables, paste:
   - `DATABASE_URL`: the Neon connection string
   - `USER_AGENT`: `Rylaide/0.1 (your-email@example.com)`. OpenStreetMap and MET Norway require a contact.
3. **Apply**. The first build takes 3–5 minutes. When the log says `Rylaide running … data in the database`,
   your link is at the top: `https://rylaide-xxxx.onrender.com`.
4. Check `https://rylaide-xxxx.onrender.com/healthz` says `"storage":"database"`.

**3. The Android app:** *Settings → App server* → paste the link → *Connect*. Or set
`rylaideServerUrl` in `android/gradle.properties` and run it again from Android Studio.

**What the free plans mean**
- The server pings itself every 10 minutes so it doesn't fall asleep. That uses about 744 of Render's
  750 free hours a month, so keep **only one** free Render service. (Set `KEEP_AWAKE=off` to let it sleep;
  then the first open after 15 idle minutes takes about a minute.)
- Render may restart a free server now and then. Riders see "Reconnecting" for a moment; no data is lost.
- Neon free: 1 GB of data (plenty: tens of thousands of rides) and 100 compute hours a month. The
  database sleeps after 5 idle minutes and wakes in about a second.
- If the database can't be reached when the server starts, the server stops and Render retries,
  rather than starting empty and overwriting your data.

Running it on your own computer needs none of this: without `DATABASE_URL` it saves to `data/rylaide.json`.

### Settings

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Web port |
| `DATA_FILE` | `data/rylaide.json` | Where accounts, groups, rides and fuel logs are stored |
| `DATABASE_URL` | none | Postgres connection string. When set, all data and bike photos are stored there (needed on free hosting) |
| `PHOTO_DIR` | `photos/` next to `DATA_FILE` | Riders' bike photos when there's no `DATABASE_URL` |
| `KEEP_AWAKE` | on (on Render) | `off` lets a free Render server sleep when idle |
| `SUPPORT_EMAIL` | none | Shown in Customer care once the Rylaide support address exists |
| `ADMIN_KEY` | none | Lets you read support reports at `/api/admin/reports` |
| `USER_AGENT` | repo URL | Sent to map services; include a contact email |
| `OSRM_URL` | public OSRM demo | Routing server |
| `NOMINATIM_URL` | public Nominatim | Place search |
| `WEATHER_URL` | MET Norway | Weather |

## Launch-day checklist

- [ ] Deployed on HTTPS and the link opens on Android Chrome and iPhone Safari
- [ ] **Install it:** Android → menu → *Install app*; iPhone → Share → *Add to Home Screen*. Check the Rylaide icon appears
- [ ] Allow **location** and **microphone** when asked
- [ ] Two phones, outdoors: create a group, join by link, and see each other move on the map
- [ ] Group voice both ways with helmet headsets (just talk; tap the mic to mute); run the Mic test first
- [ ] Android app, airplane mode with Bluetooth on: two riders next to each other still hear each other (chip shows Nearby)
- [ ] Hold SOS on one phone; the other gets the alert. Then cancel
- [ ] Navigate a short known route and check the spoken directions
- [ ] Record a short ride and check it appears in Tools → Rides
- [ ] Add emergency contacts in **You**

## Known limits of this prototype

These are fine for a launch with your riding group, but worth knowing:

- **Offline voice reaches riders near you** (Bluetooth, roughly 30–100 m per phone, relayed along a line of riders). A rider far behind with no signal is out of reach until they're back in range or online. Offline voice needs the Android app (Android 10+); browsers need internet.
- **Phone-to-phone voice isn't encrypted yet** (it's only accepted from the same group). A per-group key is the next step; see docs/offline-voice.md.
- **iPhone (web app):** group voice works while Rylaide is open on screen. iOS pauses web apps in the background, and location sharing pauses too.
- **Accounts have no password.** Each phone gets its own sign-in; signing out or clearing browser data starts a new account.
- **Free map services:** the public OSRM routing server and Nominatim search are meant for light use (about one request per second). That's fine for a riding group. For a public launch, self-host them or use a paid provider via `OSRM_URL` / `NOMINATIM_URL`.
- **One server:** all data is kept as one JSON document (a file, or one database row on free hosting). That's good for hundreds of riders, not thousands. Move to proper tables (or Firebase, as planned for the native app) before scaling.

## App icon

The "Linked Riders" logo is redrawn as a vector in `assets/brand/` and exported for every platform.

| Path | Use |
|---|---|
| `assets/brand/rylaide-icon.svg` | Master icon (rounded dark tile) |
| `assets/brand/rylaide-icon-square.svg` | Full-bleed square for stores and OS-masked icons |
| `assets/brand/rylaide-icon-foreground.svg` | Rings + signal only, transparent, for adaptive icons |
| `assets/icons/web/` | Favicons, Apple touch icon and PWA icons (used by this web app) |
| `assets/icons/android/res/` | Android launcher icons (already copied into `android/app/src/main/res/`) |
| `assets/icons/ios/AppIcon.appiconset/` | Drop into the iOS app's asset catalogue |

Colours: asphalt `#232B36`, hazard orange `#F98924`, signal teal `#2FC9C3`.

## Code layout

```
server/   Express + WebSocket backend (app.js), JSON store
web/      The app: index.html, styles.css (Figma tokens + components), service worker
web/js/   app (boot, nav), router, engine (GPS, ride, navigation, voice, SOS), ui (components), theme, map, voice
          livevoice.js (open mic, voice detector, Opus, RVP packets, mixing) · rv-capture.js (20 ms mic frames)
          heading.js (compass + GPS heading for the map that turns with you)
web/js/screens/  onboarding (+ terms, sign in), home, groups, groupinfo (info, members, expenses, settings), history (+ summary),
          vehicles (garage, vehicle, service), garage (fuel, contacts, mic test), settings (hub + pages, customer care),
          setup, ride, extra (crash, arrived, nearby, drop a pin)
server/features.js  vehicles, service, group tools, expenses, shared places, sign-in code, nearby, reverse geocode, support
server/openapi.js   API description (served at /api/v1/openapi.json and /api/docs)
android/app/src/main/java/com/rylaide/app/api/RylaideApi.kt  Kotlin API client
web/js/vehicles.js  vehicle catalogue, type detection, Home picture · bikeform.js  the bike form
android/  Android Studio project: MainActivity (WebView), RylaideBridge (speech, vibration, share, keep awake, voice)
          voice/: VoiceEngine (mic, Opus, mixing, headset), BleMesh (offline Bluetooth link), VoiceHub (routing),
          RideVoiceService (keeps voice on with the screen off), Rvp + Opus (packet, codec, voice detector)
docs/offline-voice.md  Voice spec for every platform: packet, audio, Bluetooth link, relaying, iPhone notes
tests/    api.test.js (node:test), e2e.py (Playwright, two riders)
assets/   Logo and icon sets
```

Map data © OpenStreetMap contributors · tiles by OpenFreeMap · weather by MET Norway.

## Licence and credit

© 2026 [Shubhan Punde](https://github.com/Drakeion2532). All rights reserved (see [NOTICE](NOTICE)). The code is public to read, not to copy or present as anyone else's work.

<sub>Project ID: sp2532-ce395384fbda</sub>
