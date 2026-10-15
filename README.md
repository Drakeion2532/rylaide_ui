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
- Push-to-talk: hold the big button and talk; the group hears it automatically
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

**Other servers.** Once it’s deployed (see *Deploy*), set its address in `android/gradle.properties`
(`rylaideServerUrl=https://your-app.onrender.com`) and rebuild; then the phone needs no cable. You can also change it
in the app: *Settings → App server*, or the connect screen that shows when the server can’t be reached.

**Debugging:** with the phone connected, open `chrome://inspect` in Chrome on your computer to see the app’s console.

> The Kotlin code is type-checked against the Android 34 API, but this environment can’t download the Android SDK,
> so the first full Gradle build happens in your Android Studio. If it reports anything, send the message over.

## Tests

```bash
npm test                 # 12 backend tests: accounts, bike + photo, groups, chat, voice, SOS, rides, fuel, map services, limits, restarts
npm run test:e2e         # 15 browser flows with two riders, fake mic and GPS (needs Python + Playwright)
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

## Deploy for launch (Render, about 10 minutes)

1. Push this repo to GitHub (done).
2. On [render.com](https://render.com): **New → Blueprint** → pick `rylaide_ui`. It reads `render.yaml`.
3. Set `USER_AGENT` to something like `Rylaide/0.1 (your-email@example.com)`. OpenStreetMap and MET Norway require a contact.
4. Deploy. You get an `https://rylaide-xxxx.onrender.com` link: that's the link you share.

The Blueprint uses the **Starter plan with a 1 GB disk** (about US$7/month + $0.25/GB) so accounts, groups and rides survive restarts. Render's free plan works too, but it wipes data on every restart and sleeps after 15 minutes, which logs everyone out. Not suitable for launch day.

Any Docker host works: `docker build -t rylaide . && docker run -p 3000:3000 -v rylaide-data:/data rylaide`.

### Settings

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Web port |
| `DATA_FILE` | `data/rylaide.json` | Where accounts, groups, rides and fuel logs are stored |
| `PHOTO_DIR` | `photos/` next to `DATA_FILE` | Riders' bike photos (keep it on the same persistent disk) |
| `USER_AGENT` | repo URL | Sent to map services; include a contact email |
| `OSRM_URL` | public OSRM demo | Routing server |
| `NOMINATIM_URL` | public Nominatim | Place search |
| `WEATHER_URL` | MET Norway | Weather |

## Launch-day checklist

- [ ] Deployed on HTTPS and the link opens on Android Chrome and iPhone Safari
- [ ] **Install it:** Android → menu → *Install app*; iPhone → Share → *Add to Home Screen*. Check the Rylaide icon appears
- [ ] Allow **location** and **microphone** when asked
- [ ] Two phones, outdoors: create a group, join by link, and see each other move on the map
- [ ] Push-to-talk both ways with helmet headsets; run the Mic test first
- [ ] Hold SOS on one phone; the other gets the alert. Then cancel
- [ ] Navigate a short known route and check the spoken directions
- [ ] Record a short ride and check it appears in Tools → Rides
- [ ] Add emergency contacts in **You**

## Known limits of this prototype

These are fine for a launch with your riding group, but worth knowing:

- **Voice is push-to-talk over the internet,** not live, always-on intercom, and it needs mobile data. Offline Bluetooth intercom is in the native Android app.
- **iPhone:** voice messages play while Rylaide is open on screen. iOS pauses web apps in the background, and location sharing pauses too.
- **Accounts have no password.** Each phone gets its own sign-in; signing out or clearing browser data starts a new account.
- **Free map services:** the public OSRM routing server and Nominatim search are meant for light use (about one request per second). That's fine for a riding group. For a public launch, self-host them or use a paid provider via `OSRM_URL` / `NOMINATIM_URL`.
- **One server:** data is a single JSON file. That's good for hundreds of riders, not thousands. Move to a database (Firebase, as planned for the native app) before scaling.

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
web/js/screens/  onboarding, home, groups, history (+ summary), garage (+ fuel, settings, contacts, mic test), setup, ride
web/js/vehicles.js  vehicle catalogue, type detection, Home picture · bikeform.js  the bike form
android/  Android Studio project: MainActivity (WebView), RylaideBridge (speech, vibration, share, keep awake)
tests/    api.test.js (node:test), e2e.py (Playwright, two riders)
assets/   Logo and icon sets
```

Map data © OpenStreetMap contributors · tiles by OpenFreeMap · weather by MET Norway.
