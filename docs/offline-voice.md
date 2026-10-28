# Rylaide group voice — online and offline, Android and iPhone

Group voice is **hands-free**: on a group ride the mic is open and riders just talk. Nothing is sent while
they're quiet. **One tap mutes or unmutes** (on the ride screen, or Mute in the phone notification), and
the choice is remembered. There's nothing to hold or press while riding, and nothing on the helmet headset.

It runs over two kinds of link at the same time, and the rider never switches between them:

| Link | When | Range | Platforms |
|---|---|---|---|
| **Internet** (the app's WebSocket) | Any rider with signal | Unlimited | Web, Android, iPhone |
| **Phone to phone** (Bluetooth LE, L2CAP channel) | Riders near each other, with or without signal | ~30–100 m per hop; relayed rider to rider (3 hops) | Android 10+ now, iPhone app (to build), mixed groups |
| Wi-Fi Aware (planned upgrade) | Both phones support it | ~100–250 m per hop | Android 8+ (most recent phones), iPhone 12+ on iOS 26 |

Every link carries the **same packet** (RVP, below), so a rider's voice can go phone → phone → (a rider with
signal) → server → a rider far away, and back. Duplicates (the same words arriving by two links) are
dropped by the receiver and by the server.

Only standard Bluetooth LE that both iOS and Android support is used, so **an iPhone and an Android phone
link to each other directly**. Nothing here depends on Google Play services or Apple-only frameworks.

---

## 1. Audio

| | Value |
|---|---|
| Codec | Opus, mono, 48 kHz |
| Frame | 20 ms (960 samples), one frame per packet |
| Bitrate | 24 kbps (VBR), complexity 7, in-band FEC on, expected loss 10% |
| Packets | Raw Opus packets (no Ogg). Decoders are configured with OpusHead: version 1, 1 channel, pre-skip 312, 48000 Hz |
| Jitter buffer | 60 ms per rider before playing; if a rider falls more than 300 ms behind, skip ahead |
| Mixing | Every rider has their own decoder and buffer; riders are summed, so two can talk at once |

**Voice detector** (identical on every platform, `livevoice.js` / `VoiceDetector` in `Opus.kt`). Per 20 ms frame:

```
rms   = sqrt(mean(sample²))                       samples in -1..1
floor = rms < floor ? 0.8·floor + 0.2·rms          learns the background (wind, engine)
      : talking ? 0.9985·floor + 0.0015·rms        (slowly, even while "talking", so steady wind is learned)
      :           0.995·floor + 0.005·rms
floor = max(floor, 0.0005)
loud  = rms > max(floor · k, 0.006)                k = 4.5 low · 3.0 normal · 2.0 high  (Settings → Voice sensitivity)
start talking after 2 loud frames (40 ms); stop after 30 quiet frames (600 ms)
```

Keep the last 5 frames (100 ms) while quiet and send them first when talking starts, so the first syllable
isn't clipped. When talking stops, send an END packet.

**Before the detector:** 150 Hz high-pass (wind and engine rumble) and the platform's voice processing:
- Web: `getUserMedia` echo cancellation + noise suppression + RNNoise (AudioWorklet) + compressor.
- Android: `AudioSource.VOICE_COMMUNICATION` + `NoiseSuppressor`, `AcousticEchoCanceler`, `AutomaticGainControl`.
- iPhone: `AVAudioSession` category `.playAndRecord`, mode `.voiceChat`, options `.allowBluetooth`
  (helmet headset mic) + `.defaultToSpeaker`; `AVAudioEngine.inputNode.setVoiceProcessingEnabled(true)`.
  Opus through `AVAudioConverter` (`kAudioFormatOpus`, 48 kHz, mono, 960 frames per packet).

**Headset:** the voice goes to whatever the phone is using for calls, which is the Bluetooth helmet headset
when one is connected. Android: `MODE_IN_COMMUNICATION` + `setCommunicationDevice` (BLE headset → SCO →
wired). iPhone: the `.voiceChat` session routes to the HFP/LE Audio headset automatically.

## 2. RVP — Rylaide Voice Packet

16-byte header, big-endian, then one Opus packet.

| Offset | Type | Field | Notes |
|---|---|---|---|
| 0 | u8 | version | `1` |
| 1 | u8 | kind | `1` voice (one 20 ms Opus frame) · `2` end of a sentence (no payload) |
| 2 | u32 | sender | `fnv32(userId)` |
| 6 | u32 | group | `fnv32(groupId)` |
| 10 | u16 | seq | per sender, +1 per packet, wraps |
| 12 | u8 | ttl | Bluetooth hops left (3 when sent; 0 on the internet) |
| 13 | u8 | flags | bit 0 **gateway**: carried between the phone mesh and the server by another rider |
| 14 | u16 | spurt | sentence number |
| 16 | bytes | payload | raw Opus packet |

`fnv32` is 32-bit FNV-1a over the UTF-8 bytes: start `0x811c9dc5`; for each byte `h ^= b; h = (h × 0x01000193) mod 2³²`.
Check value: `fnv32("u_abc123") = 2813818365`.

**Duplicate key:** `(sender, seq, kind)`, remembered for 10 s. Every receiver (phone, browser, server) plays or
forwards a key once.

## 3. Internet link

Binary WebSocket messages on the app's existing socket (`/ws?token=…`, after `{t:'sub', groupId}`), one RVP per
message. The server:
- drops packets whose `group` isn't the socket's group, and duplicates;
- stamps `sender` with the real `fnv32(userId)`, unless the gateway flag is set **and** the sender is a member
  of the group (a rider relaying a nearby offline rider);
- relays to everyone else in the group (not back to the sender's own sockets), skipping a slow socket rather
  than queuing (late voice is useless);
- limits a socket to 250 packets/s and 40 kB/s (one gateway rider carrying ~5 riders).

Clients map `sender` back to a member by computing `fnv32(member.id)` for the group's members.

## 4. Phone-to-phone link (Bluetooth LE)

| | UUID |
|---|---|
| Service | `d4f1b2a0-6c2e-4b8e-9f3a-72796c616964` |
| HELLO characteristic (read) | `d4f1b2a1-6c2e-4b8e-9f3a-72796c616964` |

**HELLO** (12 bytes, big-endian): `u8 version=1 · u8 flags (bit 0: has internet) · u16 L2CAP PSM · u32 fnv32(userId) · u32 fnv32(groupId)`

Every phone during a group ride:
1. **Advertises** the service UUID (connectable) and runs a GATT server with HELLO.
2. **Listens** on an L2CAP channel without encryption (Android `listenUsingInsecureL2capChannel()`,
   iOS `CBPeripheralManager.publishL2CAPChannel(withEncryption: false)`); its PSM goes in HELLO.
3. **Scans** for the service UUID. On finding a phone: connect GATT, read HELLO, disconnect GATT.
   Skip it if the group differs, it's us, or we're already linked to that rider.
4. **Who opens the link:** the rider with the lower id opens the L2CAP channel. The higher one waits 6 s for
   it; if it hasn't arrived (the other phone can't see us — e.g. an iPhone in the background), it opens the
   link itself. If two links to the same rider appear, keep the one the lower id opened.
5. **On the channel** (a byte stream on both platforms), frames are `u16 length · u8 type · body`
   (`length` counts type + body, max 1200):
   - `1` HELLO — sent first by both sides, so the side that accepted learns who called;
   - `2` RVP — one packet;
   - `3` STATUS — `u8 flags` (bit 0: has internet), sent when it changes.
6. Up to 6 linked riders per phone. A send queue of 20 frames per link; when full, the oldest is dropped.

**Routing** (`VoiceHub.kt`; the iPhone app must do the same):

| Packet from | Play it | Then |
|---|---|---|
| Your own mic | — | to the server if online (ttl 0) and to every linked rider (ttl 3) |
| The server | yes | if any linked rider has no internet: set gateway flag, ttl 3, send to those riders |
| A linked rider R | yes | if ttl > 0: ttl − 1, send to every other linked rider; if **you** are online and **R** isn't: gateway flag, ttl 0, send to the server |

Register your own packets' keys too, so your voice relayed back to you is dropped.

### iPhone notes (for the iOS app)

- Background modes: `audio`, `bluetooth-central`, `bluetooth-peripheral`. Usage strings for Bluetooth and the mic.
- In the background, iOS moves advertised service UUIDs to an "overflow area" that Android scanners can't see,
  but an iPhone in the background **can still scan** for the service UUID and connect out. That's why rule 4
  lets either side open the link after 6 s: an Android phone always sees a foreground iPhone, and a background
  iPhone finds Android phones itself.
- Open links with `CBPeripheral.openL2CAPChannel(psm)`; read and write the `CBL2CAPChannel`'s input/output
  streams on a dedicated thread or run loop.
- Use `CBCentralManagerOptionRestoreIdentifierKey` / `CBPeripheralManagerOptionRestoreIdentifierKey` so a ride
  survives iOS relaunching the app.

### Wi-Fi Aware (planned upgrade, same frames)

Once two phones are linked over Bluetooth, they can move the voice to a faster, longer-range Wi-Fi Aware
data path when both support it (Android 8+ with the hardware feature; iPhone 12+ on iOS 26, Apple's
`WiFiAware` framework). The frames above go over a TCP socket on that path; Bluetooth stays up as the
fallback. iPhone ↔ Android Wi-Fi Aware interop hasn't been publicly confirmed yet, so this is
added after testing on real phones; the Bluetooth link already works between them.

## 5. Privacy and limits

- Voice is never recorded or stored, on the phone or the server. Nothing is sent while muted or quiet.
- Phone-to-phone packets are only accepted from the same group (group id in HELLO and in every packet), but
  they're **not encrypted yet**. Next step: a per-group voice key from the server (fetched while online,
  kept on the phone) with AES-GCM on the payload, keyed on `(sender, seq)` as the nonce.
- Range: Bluetooth between bikes is roughly 30–100 m per hop, less with phones in pockets or behind the
  rider's body; a phone on the handlebar mount does best. Relaying lets a line of riders cover more.
  A rider far behind with no signal can't be reached until they're back in range or online.
- Battery: about 10–15% per hour extra with the mic, Bluetooth and screen-off audio running.

## 6. Test checklist (real phones)

1. Two Android 10+ phones, same group, both online: start a group ride on both → each hears the other;
   the ride screen shows "Mic on", the speaking ring, and **Connected**.
2. Turn on airplane mode on both, Bluetooth back on → the chip shows **Nearby**, voice keeps working.
3. Three phones: A offline, B online between A and C, C far away online → C hears A through B (gateway).
4. Tap the mic → **Muted**, the other phones stop hearing you; the notification's Mute does the same; the next
   ride starts muted until you tap again.
5. Screen off, phone in a pocket, helmet headset connected → voice continues both ways.
6. Mixed: one browser rider online + two app riders offline next to each other + one gateway → everyone hears
   everyone they should.
