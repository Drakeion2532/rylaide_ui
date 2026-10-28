// OpenAPI 3 description of the Rylaide API, served at /api/v1/openapi.json and readable at /api/docs.
// The Android app's Kotlin client (android/app/src/main/java/com/rylaide/app/api/RylaideApi.kt) follows this.
const E = (method, path, tag, summary, { body, auth = true, res, query } = {}) => ({ method, path, tag, summary, body, auth, res, query });

const ENDPOINTS = [
  // accounts
  E('post', '/users', 'Account', 'Create an account (06). Returns the token to send as `Authorization: Bearer <token>`.', { auth: false, body: { name: 'Asha', agreed: true, vehicle: { type: 'classic', make: 'Royal Enfield', model: 'Classic 350', odometer: 31220 } }, res: '{ user, token }' }),
  E('post', '/signin', 'Account', 'Sign in on another phone with the account code (05).', { auth: false, body: { code: 'K7QM-4XPA' }, res: '{ user, token }' }),
  E('get', '/me', 'Account', 'The signed-in rider, with their active vehicle.', { res: '{ user }' }),
  E('patch', '/me', 'Account', 'Update name, colour, or the active vehicle.', { body: { name: 'Asha', color: '#2FC9C3' }, res: '{ user }' }),
  E('delete', '/me', 'Account', 'Delete the account and its data.', { body: { confirm: 'DELETE' } }),
  E('get', '/me/account', 'Account', 'Account code for signing in on another phone (44).', { res: '{ code, createdAt, termsAt }' }),
  E('post', '/me/account/code', 'Account', 'Make a new account code (the old one stops working).', { res: '{ code }' }),
  E('post', '/me/photo', 'Garage', 'Photo of the active vehicle (base64 JPEG, under 2 MB).', { body: { data: '<base64 jpeg>' } }),
  E('delete', '/me/photo', 'Garage', 'Remove the active vehicle’s photo.'),
  E('get', '/config', 'App', 'Public app settings (support email once set, version).', { auth: false, res: '{ supportEmail, version }' }),
  E('post', '/support', 'App', 'Send a problem report to Rylaide support (58d). Works before sign-in with `contact`.', { auth: false, body: { topic: 'voice', message: 'Can’t hear my group', contact: '+91…', info: 'device details' }, res: '{ ref }' }),
  // garage
  E('get', '/vehicles', 'Garage', 'All vehicles and which one is active (12).', { res: '{ vehicles, activeId, user }' }),
  E('post', '/vehicles', 'Garage', 'Add a vehicle (11e).', { body: { type: 'ev-scooter', make: 'Ather', model: '450X', odometer: 800, year: 2024, reg: 'MH12AB1234', nickname: 'Office ride', makeActive: false } }),
  E('patch', '/vehicles/{vid}', 'Garage', 'Edit a vehicle (11f). Fields left out stay as they are.', { body: { nickname: 'Daily' } }),
  E('delete', '/vehicles/{vid}', 'Garage', 'Remove a vehicle with its fuel and service logs.'),
  E('post', '/vehicles/{vid}/active', 'Garage', 'Ride this vehicle: shown on Home, rides and fuel are logged to it.'),
  E('post', '/vehicles/{vid}/photo', 'Garage', 'Photo of this vehicle.', { body: { data: '<base64 jpeg>' } }),
  E('delete', '/vehicles/{vid}/photo', 'Garage', 'Remove this vehicle’s photo.'),
  E('get', '/vehicles/{vid}/service', 'Garage', 'Service & documents log with reminders (11j).', { res: '{ vehicle, entries, reminders, stats, types }' }),
  E('post', '/vehicles/{vid}/service', 'Garage', 'Add a service or document entry.', { body: { type: 'oil', date: '2026-10-28', odometer: 32100, cost: 650, nextKm: 35100, nextDate: null, note: 'Motul 20W50' } }),
  E('delete', '/vehicles/{vid}/service/{sid}', 'Garage', 'Delete a service entry.'),
  E('get', '/fuel', 'Garage', 'Fuel log of a vehicle (11d); defaults to the active one.', { query: ['vehicle'], res: '{ entries, stats }' }),
  E('post', '/fuel', 'Garage', 'Add a fill-up. The vehicle’s odometer follows the log.', { body: { vehicleId: '…', odometer: 32060, litres: 9.2, pricePerLitre: 106, full: true, date: '2026-10-28', estimated: false } }),
  E('delete', '/fuel/{fid}', 'Garage', 'Delete a fill-up.'),
  E('get', '/contacts', 'Safety', 'Emergency contacts.', { res: '{ contacts }' }),
  E('put', '/contacts', 'Safety', 'Replace emergency contacts (up to 5).', { body: { contacts: [{ name: 'Maa', phone: '+919800000000' }] } }),
  // groups
  E('get', '/groups', 'Groups', 'My groups (38).', { res: '{ groups }' }),
  E('post', '/groups', 'Groups', 'Create a group (40).', { body: { name: 'Weekend Riders' }, res: '{ group }' }),
  E('post', '/groups/join', 'Groups', 'Join with a 6-character code.', { body: { code: 'BSWBJV' }, res: '{ group }' }),
  E('get', '/groups/{id}', 'Groups', 'One group with members, plan and live ride.'),
  E('patch', '/groups/{id}', 'Groups', 'Rename / describe (leader, G14).', { body: { name: 'Ghat Gang', description: 'Sunday rides' } }),
  E('delete', '/groups/{id}', 'Groups', 'Delete the group (leader).'),
  E('post', '/groups/{id}/leave', 'Groups', 'Leave the group.'),
  E('post', '/groups/{id}/code', 'Groups', 'New invite code (leader).'),
  E('post', '/groups/{id}/members/{uid}/remove', 'Groups', 'Remove a rider (leader, 41).'),
  E('post', '/groups/{id}/leader', 'Groups', 'Hand over leadership.', { body: { userId: '…' } }),
  E('put', '/groups/{id}/plan', 'Groups', 'Set or clear the ride plan.', { body: { destination: 'Sinhagad Fort', lat: 18.3663, lng: 73.7559, meetAt: '6:30 am' } }),
  E('get', '/groups/{id}/messages', 'Groups', 'Last 100 chat messages.'),
  E('get', '/groups/{id}/qr.svg', 'Groups', 'Invite QR code (SVG).'),
  E('get', '/groups/{id}/rides', 'Groups', 'Rides recorded with this group (G01 Rides tab).'),
  E('post', '/groups/{id}/ride', 'Groups', 'Start a live group ride; picked riders get a `ride_live` invite (17).', { body: { riders: ['…'], destination: 'Sinhagad Fort', lat: 18.3663, lng: 73.7559 } }),
  E('delete', '/groups/{id}/ride', 'Groups', 'End the live group ride.'),
  E('get', '/groups/{id}/expenses', 'Groups', 'Expenses, balances and fewest payments to settle (39c).', { res: '{ expenses, balances, settle, total }' }),
  E('post', '/groups/{id}/expenses', 'Groups', 'Add an expense, or a settlement with `settlement: true`.', { body: { title: 'Fuel', amount: 900, paidBy: '…', split: ['…', '…'] } }),
  E('delete', '/groups/{id}/expenses/{eid}', 'Groups', 'Delete an expense.'),
  E('get', '/groups/{id}/shared', 'Groups', 'Shared places (G01 Shared tab).'),
  E('post', '/groups/{id}/shared', 'Groups', 'Share a place.', { body: { name: 'Sharma Dhaba', kind: 'food', lat: 18.4, lng: 73.8, note: 'Best parathas' } }),
  E('delete', '/groups/{id}/shared/{sid}', 'Groups', 'Remove a shared place.'),
  E('post', '/nearby', 'Groups', 'Be visible to riders within 500 m and list them (16). Call every few seconds while the screen is open.', { body: { lat: 18.52, lng: 73.85 }, res: '{ riders, radius }' }),
  E('delete', '/nearby', 'Groups', 'Stop being visible.'),
  E('post', '/nearby/group', 'Groups', 'Make a group with picked nearby riders.', { body: { riders: ['…'], name: 'Petrol pump crew' } }),
  // rides
  E('get', '/rides', 'Rides', 'My rides, newest first (36), without GPS points.'),
  E('get', '/rides/{rid}', 'Rides', 'One ride with its GPS points (34).'),
  E('post', '/rides', 'Rides', 'Save a recorded ride. `points` are [lat, lng, timestampMs].', { body: { points: [[18.52, 73.85, 1761600000000]], duration: 3600, maxSpeed: 22.5, startedAt: 1761600000000, destination: 'Sinhagad Fort', groupId: null, vehicleId: '…', pillion: false, quick: false, refills: [{ litres: 9, cost: 950 }] } }),
  E('delete', '/rides/{rid}', 'Rides', 'Delete a ride.'),
  // maps
  E('get', '/route', 'Maps', 'Up to 3 routes (Best / Fastest / Scenic) with turn-by-turn steps (24).', { query: ['from', 'to'], res: '{ distance, duration, geometry, steps, options }' }),
  E('get', '/search', 'Maps', 'Place search (22).', { query: ['q', 'near'], res: '{ results: [{ name, lat, lng }] }' }),
  E('get', '/reverse', 'Maps', 'Name of a dropped pin (22e).', { query: ['lat', 'lng'], res: '{ name, lat, lng }' }),
  E('get', '/weather', 'Maps', 'Weather now at a place (19).', { query: ['lat', 'lng'], res: '{ temp, wind, symbol, rain }' }),
];

const REALTIME = `
## Realtime (WebSocket)

Connect to \`wss://<host>/ws?token=<token>\`. All messages are JSON with a \`t\` field.

**Send:** \`{t:'sub', groupId}\` to open a group · \`{t:'loc', lat, lng, speed, heading}\` about once a second while riding ·
\`{t:'chat', text}\` · \`{t:'typing'}\` · \`{t:'sos', lat, lng}\` / \`{t:'sos_cancel'}\` · \`{t:'ping', ts}\`.

**Live voice (hands-free, open mic):** binary WebSocket messages, one RVP packet each: a 16-byte header
(version 1 · kind 1 voice / 2 end of sentence · sender fnv32(userId) · group fnv32(groupId) · seq · ttl · flags · spurt) and one
20 ms Opus frame (48 kHz mono, 24 kbps). Send only while the rider is speaking (voice detector); the server stamps the sender,
drops duplicates and relays to the group. The same packet travels phone to phone over Bluetooth when there's no signal.
Full spec: docs/offline-voice.md in the repo (Android: \`voice/VoiceEngine.kt\`, \`voice/BleMesh.kt\`).

**Voice clips (fallback for browsers without WebCodecs):** \`{t:'vchunk', sid, seq, mime:'audio/webm;codecs=opus', data:<base64>}\`
every 200 ms while the rider speaks, then \`{t:'vchunk', sid, seq:-1, end:true, live:true, duration}\`. \`{t:'vcancel', sid}\` drops one.
Listeners receive the same messages with \`from\` and play slices in \`seq\` order.

**Receive:** \`snapshot\` (after sub) · \`presence\` · \`loc\` · \`chat\` · \`typing\` · \`vchunk\` / \`vcancel\` · \`sos\` / \`sos_cancel\` ·
binary RVP voice packets · \`members\` (group changed) · \`ride_live\` (you were picked for a ride) · \`group_added\` (Nearby) · \`group_gone\` (removed or deleted) ·
\`expenses\` / \`shared\` (refresh those tabs) · \`error\`.`;

module.exports = ({ base = '' } = {}) => {
  const paths = {};
  for (const e of ENDPOINTS) {
    const params = [...e.path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }))
      .concat((e.query || []).map((q) => ({ name: q, in: 'query', required: ['q', 'from', 'to', 'lat', 'lng'].includes(q), schema: { type: 'string' } })));
    (paths[`/api/v1${e.path}`] ||= {})[e.method] = {
      tags: [e.tag], summary: e.summary, ...(e.auth ? {} : { security: [] }),
      ...(params.length ? { parameters: params } : {}),
      ...(e.body ? { requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' }, example: e.body } } } } : {}),
      responses: {
        200: { description: e.res ? `OK: ${e.res}` : 'OK', content: { 'application/json': { schema: { type: 'object' } } } },
        400: { description: 'Invalid input: `{ error }` with a message you can show the rider' },
        ...(e.auth ? { 401: { description: 'Missing or unknown token: sign in again' } } : {}),
      },
    };
  }
  return {
    openapi: '3.0.3',
    info: {
      title: 'Rylaide API', version: require('../package.json').version,
      description: `REST + WebSocket API behind the Rylaide app. Send \`Authorization: Bearer <token>\` (from POST /api/v1/users or /api/v1/signin). Errors are \`{ "error": "message" }\`.\n${REALTIME}`,
    },
    servers: [{ url: base || '/' }],
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
    security: [{ bearer: [] }],
    tags: ['Account', 'Garage', 'Safety', 'Groups', 'Rides', 'Maps', 'App'].map((name) => ({ name })),
    paths,
  };
};
