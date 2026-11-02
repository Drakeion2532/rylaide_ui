// 08 → 43 Settings → 44–59 (Figma navigation map: every settings page goes Up to 43; 43 → Home)
//   44 Account · 45 Appearance · 46 Riding & directions · 47 Safety & SOS · 48 Location & privacy · 49 Audio & headset
//   54 Offline & storage · 55 About (56 Terms · 57 Privacy) · 58 Customer care → 58b Rylaide Assistant → 58c fix → 58e solved / 58d contact support
import { h, store, native } from '../util.js';
import { api } from '../api.js';
import { ctx, rt, emit, setting, setSetting } from '../state.js';
import { ACCENTS, applyTheme, currentLight } from '../theme.js';
import { ic, button, listItem, switchEl, field, dialog, snackbar, segmented, withLoading, avatar, page, sectionTitle, sheet, VOICE_MODES, AUDIO_OUT, WATCH_NOTE } from '../ui.js';
import { register, push, back, upTo } from '../router.js';
import { supportEmail } from '../legal.js';
import * as engine from '../engine.js';

const VERSION = '0.5.0';
const go = (name, params) => () => push(name, params);
const row = (icon, title, sub, name, params) => listItem({ icon, title, sub, trail: ic('chevron_right'), onclick: go(name, params), attrs: { 'data-page': name } });
const toggle = (icon, title, sub, key, def, after) => listItem({ icon, title, sub, trail: switchEl({ checked: setting(key, def), label: title, onchange: (v) => { setSetting(key, v); after?.(v); } }) });

// ---------------------------------------------------------------- 43 Settings
register('settings', (el) => {
  const { body } = page(el, 'Settings', { back: () => upTo('home') }); // 43 → Home
  const render = () => {
    const u = ctx.user;
    body.replaceChildren(
      h('button', { type: 'button', class: 'profile-card', onclick: go('account') },
        avatar(u.name, { size: 'l', color: u.color }), h('span', { class: 'main' }, h('span', { class: 'title-l' }, u.name), h('span', { class: 'body-m variant' }, 'Account, sign in on another phone')), ic('chevron_right')),
      sectionTitle('Riding'),
      h('div', { class: 'list' },
        row('palette', 'Appearance', 'Theme, accent colour, Glove Mode', 'appearance'),
        row('directions', 'Riding & directions', 'Voice, breaks, location sharing', 'riding'),
        row('health_and_safety', 'Safety & SOS', `Crash detection ${setting('crash', true) ? 'on' : 'off'} · ${ctx.contacts.length} contacts`, 'safety'),
        row('headset_mic', 'Audio & headset', 'Mic test, noise cancel, voice chat', 'audio')),
      sectionTitle('Privacy & data'),
      h('div', { class: 'list' },
        row('location_on', 'Location & privacy', setting('share', true) ? 'Shared with your group during group rides' : 'Not shared', 'privacy'),
        row('cloud_download', 'Offline & storage', 'Saved maps, unsent rides', 'storage')),
      sectionTitle('Help'),
      h('div', { class: 'list' },
        row('support_agent', 'Customer care', 'Rylaide Assistant, contact support', 'care'),
        row('info', 'About Rylaide', `Version ${VERSION} · terms and privacy`, 'about'),
        native() ? listItem({ icon: 'dns', title: 'App server', sub: (() => { try { return native().serverUrl(); } catch { return location.origin; } })(), trail: ic('chevron_right'), onclick: () => native().openServerSettings() }) : null),
      h('div', { style: 'height:32px' }));
  };
  render();
  el.onResume = render;
});

// ---------------------------------------------------------------- 44 Account
const COLORS = ['#F98924', '#2FC9C3', '#E5484D', '#8B7CF6', '#F5C542', '#4CC38A', '#EC6AA8', '#5AA9FF'];
function saveUser(u) { ctx.user = u; store.set('user', u); emit('user', u); }

register('account', (el) => {
  const { body } = page(el, 'Account', { back });
  const name = field({ label: 'Your name', value: ctx.user.name, attrs: { maxlength: 40, name: 'name' }, support: 'What your group sees' });
  const codeEl = h('span', { class: 'code-big', style: 'font-size:28px;letter-spacing:4px' }, '····-····');
  let code = '';
  api.get('/api/me/account').then((a) => { code = a.code; codeEl.textContent = a.code; }).catch((e) => (codeEl.textContent = e.status === 0 ? 'Offline' : '–'));
  const colors = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Your colour on the map' });
  const drawColors = () => colors.replaceChildren(...COLORS.map((c) => h('button', {
    type: 'button', class: 'swatch', role: 'radio', 'aria-checked': String(ctx.user.color?.toLowerCase() === c.toLowerCase()), 'aria-label': `Colour ${c}`, style: `background:${c};color:#1a1c1e`,
    onclick: async () => { try { saveUser((await api.patch('/api/me', { color: c })).user); drawColors(); } catch (e) { snackbar(e.message); } },
  }, ic('check'))));
  drawColors();
  body.append(
    h('form', { class: 'row gap8', style: 'align-items:flex-start;margin-top:16px', onsubmit: async (e) => {
      e.preventDefault();
      try { saveUser((await api.patch('/api/me', { name: name.input.value })).user); name.setError(''); snackbar('Name saved'); } catch (err) { name.setError(err.message); }
    } }, h('div', { class: 'grow' }, name), button('Save', { style: 'tonal', type: 'submit', attrs: { style: 'margin-top:4px' } })),
    h('div', { class: 'title-s', style: 'padding:20px 4px 12px' }, 'Your colour on the map'), colors,
    sectionTitle('Sign in on another phone'),
    h('div', { class: 'card pad stack gap12', style: 'align-items:flex-start' },
      h('p', { class: 'body-m variant', style: 'margin:0' }, 'On the new phone, tap “I already have an account” and enter this code. Keep it private, like a password.'),
      codeEl,
      h('div', { class: 'row gap8', style: 'flex-wrap:wrap' },
        button('Copy code', { style: 'tonal', icon: 'content_copy', onclick: async () => { try { await navigator.clipboard.writeText(code); snackbar('Code copied'); } catch { snackbar(code); } } }),
        button('New code', { style: 'text', icon: 'autorenew', onclick: async () => {
          if (!(await dialog({ title: 'Make a new code?', body: 'The old code stops working. Phones already signed in stay signed in.', confirm: 'New code' }))) return;
          try { code = (await api.post('/api/me/account/code')).code; codeEl.textContent = code; snackbar('New code ready'); } catch (e) { snackbar(e.message); }
        } }))),
    sectionTitle('This phone'),
    h('div', { class: 'list' },
      listItem({ icon: 'logout', title: 'Sign out of this phone', sub: 'Sign back in any time with your account code', onclick: async () => {
        if (!(await dialog({ title: 'Sign out?', body: code ? `Write down your account code first: ${code}` : 'You’ll need your account code to sign back in.', confirm: 'Sign out' }))) return;
        rt.close(); api.setToken(null); ['user', 'groupId', 'groupsCache'].forEach(store.del); location.reload();
      } }),
      listItem({ icon: 'delete_forever', title: 'Delete account', sub: 'Removes your rides, vehicles and logs', cls: 'danger-row', onclick: deleteAccount })),
    h('div', { style: 'height:32px' }));
});

async function deleteAccount() {

  sheet((close) => {
    const conf = field({ label: 'Type DELETE to confirm', attrs: { autocapitalize: 'characters', name: 'confirm' }, onSurface: true });
    const goBtn = button('Delete my account', { size: 'large', wide: true, type: 'submit', attrs: { style: 'background:var(--error);color:var(--on-error)' } });
    return h('form', { class: 'stack gap16', onsubmit: async (e) => {
      e.preventDefault();
      await withLoading(goBtn, async () => {
        try {
          await api.req('DELETE', '/api/me', { confirm: conf.input.value });
          close(); rt.close(); api.setToken(null); localStorage.clear(); location.reload();
        } catch (err) { conf.setError(err.message); }
      });
    } }, h('h2', { class: 'headline-s' }, 'Delete your account?'),
      h('p', { class: 'body-m variant', style: 'margin:0' }, 'Your rides, vehicles, photos, fuel and service logs and emergency contacts are deleted. You leave all your groups. This can’t be undone.'),
      conf, goBtn);
  });
}

// ---------------------------------------------------------------- 45 Appearance
register('appearance', (el) => {
  const { body } = page(el, 'Appearance', { back });
  const render = () => {
    const light = currentLight();
    body.replaceChildren(
      sectionTitle('Theme'),
      segmented([{ value: 'auto', label: 'Auto' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }], setting('theme', 'auto'), (v) => { setSetting('theme', v); applyTheme(); render(); }, { label: 'Theme' }),
      h('p', { class: 'body-s variant', style: 'padding:8px 4px 0' }, setting('theme', 'auto') === 'auto' ? `Auto follows sunrise and sunset where you are. Right now: ${light === 'day' ? 'Day' : light === 'evening' ? 'Evening' : 'Night'}.` : 'Fixed until you switch back to Auto.'),
      sectionTitle('Accent colour'),
      h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Accent colour' }, Object.entries(ACCENTS).map(([k, a]) => h('button', {
        type: 'button', class: 'swatch', role: 'radio', 'aria-checked': String(setting('accent', 'blue') === k), 'aria-label': a.name, style: `background:${light === 'day' ? a.l[0] : a.d[0]};color:${light === 'day' ? a.l[1] : a.d[1]}`,
        onclick: () => { setSetting('accent', k); applyTheme(); render(); },
      }, ic('check')))),
      sectionTitle('Riding with gloves'),
      h('div', { class: 'list' }, toggle('back_hand', 'Glove Mode', 'Bigger buttons and ride controls (80 dp)', 'glove', false, () => applyTheme())),
      h('div', { style: 'height:32px' }));
  };
  render();
});

// ---------------------------------------------------------------- 46 Riding & directions
register('riding', (el) => {
  const { body } = page(el, 'Riding & directions', { back });
  const mins = setting('breakMins', 45);
  body.append(
    sectionTitle('Directions'),
    h('div', { class: 'list' },
      listItem({ icon: 'volume_up', title: 'Test the voice', sub: 'Hear how directions sound', onclick: () => engine.speak('In 500 metres, turn left onto Ghat Road.', 'nav', { force: true }) })),
    h('div', { style: 'padding:12px 4px 0' }, h('div', { class: 'label-l variant', style: 'margin-bottom:8px' }, 'Voice guidance (also on the map while riding)'),
      segmented(VOICE_MODES.map((m) => ({ value: m.value, label: m.label })), engine.voiceGuide(), (v) => engine.setVoiceGuide(v), { label: 'Voice guidance' })),
    sectionTitle('Smartwatch'),
    watchSection(),
    sectionTitle('Breaks'),
    h('div', { class: 'list' }, toggle('free_breakfast', 'Break reminders', 'On every ride. Always on when you ride with a pillion.', 'breaks', false)),
    h('div', { style: 'padding:12px 4px 0' }, h('div', { class: 'label-l variant', style: 'margin-bottom:8px' }, 'Remind me every'),
      segmented([30, 45, 60, 90].map((m) => ({ value: String(m), label: String(m) })), String(mins), (v) => setSetting('breakMins', Number(v)), { label: 'Break interval in minutes' }),
      h('div', { class: 'body-s variant', style: 'padding:6px 4px 0' }, 'minutes of riding')),
    sectionTitle('Group rides'),
    h('div', { class: 'list' },
      toggle('share_location', 'Share my location', 'Only with the group you ride with', 'share', true),
      toggle('notifications_active', 'Ride invites', 'Show when someone in your group starts a ride', 'invites', true)),
    h('p', { class: 'body-s variant', style: 'padding:16px 4px 32px' }, 'Distances are in kilometres and speeds in km/h. Over 80 km/h the speedometer turns amber.'));
});

/**
 * Smartwatch: budget watches (Noise, Fire-Boltt, boAt…) can't run apps but show the phone's notifications,
 * so turns and group alerts go to the watch as notifications. Only in the Android app.
 */
function watchSection() {
  const how = h('p', { class: 'body-s variant', style: 'padding:8px 4px 0;margin:0' },
    'Works with any watch that shows your phone’s notifications: Noise, Fire-Boltt, boAt, Amazfit, Galaxy Watch and others. ',
    'In your watch’s phone app (NoiseFit, Da Fit, boAt Crest…), turn on notifications for Rylaide. ', WATCH_NOTE);
  if (!engine.watchSupported()) {
    return h('div', {}, h('div', { class: 'list' }, listItem({ icon: 'watch', title: 'Show on my watch', sub: 'Available in the Rylaide Android app' })), how);
  }
  const test = listItem({ icon: 'send', title: 'Send a test to my watch', sub: 'Check it appears on your watch', onclick: () => {
    engine.toWatch('Test from Rylaide', 'In 300 m, turn left onto Ring Road');
    snackbar('Sent. Look at your watch.');
  } });
  test.hidden = !engine.watchOn();
  return h('div', {}, h('div', { class: 'list' },
    listItem({ icon: 'watch', title: 'Show on my watch', sub: 'Turns, arrival, breaks, group SOS', trail: switchEl({ checked: engine.watchOn(), label: 'Show on my watch', onchange: (v) => {
      const ok = engine.setWatch(v);
      test.hidden = !v;
      if (v) snackbar(ok ? 'Sent a test to your watch' : 'Notifications are off for Rylaide. Turn them on in your phone’s settings.');
    } }) }),
    test), how);
}

// ---------------------------------------------------------------- 47 Safety & SOS
register('safety', (el) => {
  const { body } = page(el, 'Safety & SOS', { back });
  const render = () => body.replaceChildren(
    h('div', { class: 'banner dark', style: 'margin:8px 0 0' }, ic('sos'), h('span', { class: 'main' }, h('span', { class: 'title-s' }, 'Hold SOS for 1.5 seconds'), h('span', { class: 'body-m' }, 'During a ride. A 5 second countdown lets you cancel, then your group gets your location.'))),
    sectionTitle('Crash detection'),
    h('div', { class: 'list' },
      toggle('car_crash', 'Crash detection', 'After a hard impact while riding, if you don’t move, Rylaide counts down 30 s and then sends SOS.', 'crash', true, () => render()),
      listItem({ icon: 'science', title: 'Try it', sub: 'Shows the countdown. Nothing is sent.', onclick: () => push('crash', { test: true }, { anim: 'up' }) })),
    sectionTitle('Who to call'),
    h('div', { class: 'list' },
      row('emergency', 'Emergency contacts', ctx.contacts.length ? ctx.contacts.map((c) => c.name).join(', ') : 'Add who SOS should call', 'contacts'),
      listItem({ icon: 'call', title: 'Emergency number', sub: '112 · works anywhere in India', trail: h('a', { class: 'btn text', href: 'tel:112' }, 'Call') })),
    h('p', { class: 'body-s variant', style: 'padding:16px 4px 32px' }, 'SOS and crash detection need your phone’s internet and battery. They help your group find you; they don’t replace calling 112.'));
  render();
  el.onResume = render;
});

// ---------------------------------------------------------------- 48 Location & privacy
register('privacy', (el) => {
  const { body } = page(el, 'Location & privacy', { back });
  body.append(
    sectionTitle('Your location'),
    h('div', { class: 'list' },
      toggle('share_location', 'Share during group rides', 'Your group sees you on their map', 'share', true),
      listItem({ icon: 'person', title: 'Solo rides', sub: 'Never shared. Only you see the route in History.' }),
      listItem({ icon: 'nearby', title: 'Nearby', sub: 'Only while the Nearby screen is open, and only your rough distance.' })),
    sectionTitle('Your data'),
    h('div', { class: 'list' },
      row('description', 'Privacy notice', 'What we keep and why', 'legal', { doc: 'privacy' }),
      row('manage_accounts', 'Delete account', 'In Account', 'account')),
    h('div', { style: 'height:32px' }));
});

// ---------------------------------------------------------------- 49 Audio & headset
register('audio', (el) => {
  const { body } = page(el, 'Audio & headset', { back });
  body.append(
    h('div', { class: 'list mt8' }, row('mic', 'Mic test', 'Check your helmet headset', 'mictest')),
    sectionTitle('Sound comes from'),
    h('div', { class: 'list' }, ...AUDIO_OUT.map((o) => listItem({
      icon: o.icon, title: o.label, sub: o.sub, cls: 'audio-out', attrs: { 'data-out': o.value, role: 'radio' },
      trail: ic(engine.audioOut() === o.value ? 'radio_button_checked' : 'radio_button_unchecked'),
      onclick: () => { engine.setAudioOut(o.value); renderOut(); snackbar(o.value === 'speaker' ? 'Phone speaker and mic' : 'Headset'); },
    }))),
    h('p', { class: 'body-s variant', style: 'padding:8px 4px 0' }, WATCH_NOTE),
    sectionTitle('Map'),
    h('div', { class: 'list' }, listItem({ icon: 'explore', title: 'Map turns with you', sub: 'Like Google Maps: the way you face is up. Uses the compass when you’re stopped, GPS when moving.', trail: switchEl({ checked: engine.mapTurns(), label: 'Map turns with you', onchange: (v) => engine.setMapTurns(v) }) })),
    sectionTitle('Voice chat'),
    h('div', { class: 'list' },
      listItem({ icon: 'campaign', title: 'Voice chat', sub: 'On group rides your mic is open: just talk. Nothing is sent while you’re quiet.', trail: switchEl({ checked: ctx.voiceOn, label: 'Voice chat', onchange: (v) => engine.setVoiceOn(v) }) }),
      listItem({ icon: 'mic_off', title: 'Start rides muted', sub: 'Tap the mic in the ride to talk. Same as tapping Mute during a ride.', trail: switchEl({ checked: ctx.micMuted, label: 'Start rides muted', onchange: (v) => engine.setMicMuted(v) }) }),
      listItem({ icon: 'noise_control_off', title: 'Noise cancel', sub: 'Removes wind and engine noise from your voice', trail: switchEl({ checked: ctx.noiseCancel, label: 'Noise cancel', onchange: (v) => engine.setNoiseCancel(v) }) })),
    h('div', { style: 'padding:16px 4px 4px' }, h('div', { class: 'title-s', style: 'padding-bottom:4px' }, 'Voice sensitivity'),
      h('p', { class: 'body-s variant', style: 'margin:0 0 8px' }, 'How loud you need to speak before your group hears you. Pick Low if wind keeps opening your mic.'),
      segmented([{ value: 'low', label: 'Low' }, { value: 'normal', label: 'Normal' }, { value: 'high', label: 'High' }], setting('voiceSensitivity', 'normal'), (v) => engine.setVoiceSensitivity(v), { label: 'Voice sensitivity' })),
    h('p', { class: 'body-s variant', style: 'padding:16px 4px 32px' }, 'Pair your helmet headset with Bluetooth before you start. In the Android app, voice keeps working with nearby riders when there’s no signal.'));
  function renderOut() {
    el.querySelectorAll('.audio-out').forEach((r) => {
      const on = r.dataset.out === engine.audioOut();
      r.setAttribute('aria-checked', String(on));
      r.querySelector('.trail').replaceChildren(ic(on ? 'radio_button_checked' : 'radio_button_unchecked'));
    });
  }
  renderOut();
});

// ---------------------------------------------------------------- 54 Offline & storage
register('storage', (el) => {
  const { body } = page(el, 'Offline & storage', { back });
  const render = async () => {
    let used = null, maps = 0;
    try { const est = await navigator.storage?.estimate?.(); used = est?.usage ?? null; } catch { /* unsupported */ }
    try { const c = await caches.open('rylaide-tiles'); maps = (await c.keys()).length; } catch { /* no cache */ }
    const unsent = store.get('unsentRides', []).length;
    body.replaceChildren(
      h('div', { class: 'stat-row', style: 'margin-top:8px' },
        h('div', { class: 'stat tile' }, h('div', { class: 'v' }, h('span', { class: 'ride-metric' }, used != null ? (used / 1048576).toFixed(1) : '–'), h('span', { class: 'u' }, 'MB')), h('span', { class: 'l' }, 'On this phone')),
        h('div', { class: 'stat tile' }, h('span', { class: 'ride-metric' }, String(maps)), h('span', { class: 'l' }, 'Map pieces')),
        h('div', { class: 'stat tile' }, h('span', { class: 'ride-metric' }, String(unsent)), h('span', { class: 'l' }, 'Unsent rides'))),
      sectionTitle('Offline'),
      h('div', { class: 'list' },
        listItem({ icon: 'map', title: 'Saved map areas', sub: 'Areas you’ve viewed are kept for when signal drops. Your planned route is always saved.' }),
        unsent ? listItem({ icon: 'cloud_upload', title: 'Send unsent rides now', sub: `${unsent} ride${unsent === 1 ? '' : 's'} recorded without signal`, onclick: async () => { await engine.flushUnsentRides(); render(); } }) : null),
      sectionTitle('Free up space'),
      h('div', { class: 'list' },
        listItem({ icon: 'delete_sweep', title: 'Clear saved maps', sub: 'They download again when you next look', onclick: async () => {
          try { await caches.delete('rylaide-tiles'); snackbar('Saved maps cleared'); render(); } catch { snackbar('Nothing to clear'); }
        } })),
      h('div', { style: 'height:32px' }));
  };
  body.append(h('div', { class: 'empty' }, h('span', { class: 'spinner' })));
  render();
});

// ---------------------------------------------------------------- 55 About
register('about', (el) => {
  const { body } = page(el, 'About Rylaide', { back });
  body.append(
    h('div', { class: 'about-head' }, h('img', { src: '/icons/icon-192.png', alt: '', width: 72, height: 72, style: 'border-radius:18px' }),
      h('div', {}, h('div', { class: 'headline-s' }, 'Rylaide'), h('div', { class: 'body-m variant' }, `Version ${VERSION} · prototype`), h('div', { class: 'body-s variant' }, 'Ride together. Talk without signal. Get home safe.'))),
    h('div', { class: 'list mt16' },
      row('description', 'Terms of use', null, 'legal', { doc: 'terms' }),
      row('policy', 'Privacy notice', null, 'legal', { doc: 'privacy' }),
      row('support_agent', 'Customer care', 'Rylaide Assistant, contact support', 'care')),
    sectionTitle('Credits'),
    h('p', { class: 'body-s variant', style: 'padding:0 4px 32px;line-height:1.6' }, 'Map data © OpenStreetMap contributors · map tiles by OpenFreeMap · routing by OSRM · place search by Nominatim · weather by MET Norway · photos from Unsplash · icons: Material Symbols · fonts: Google Sans Flex and Roboto.'));
});

// ---------------------------------------------------------------- 58 Customer care
const TOPICS = [
  { id: 'gps', icon: 'location_off', title: 'My location isn’t showing', steps: [
    ['Turn on Location', 'Phone Settings → Location → on, and set it to high accuracy.', { label: 'Try again', run: () => engine.startLocation() }],
    ['Allow Rylaide', 'Phone Settings → Apps → Rylaide (or your browser) → Permissions → Location → Allow.'],
    ['Get a clear sky', 'GPS needs open sky. Step outside for a minute; tunnels and parking garages block it.'],
  ] },
  { id: 'voice', icon: 'hearing_disabled', title: 'I can’t hear my group, or they can’t hear me', steps: [
    ['Run the mic test', 'Check the bar moves when you speak, and play back your recording.', { label: 'Open mic test', run: () => push('mictest') }],
    ['Voice chat on', 'In the ride hub, Group tab → Voice chat must be on to hear others.'],
    ['Not muted', 'The mic button in the ride should say “Mic on”. If it says “Muted”, tap it once. Then just talk.'],
    ['Wind opening the mic', 'If your group hears wind, set Voice sensitivity to Low in Audio & headset.', { label: 'Audio & headset', run: () => push('audio') }],
    ['Headset connected', 'Pair your helmet headset with Bluetooth before opening Rylaide.'],
  ] },
  { id: 'map', icon: 'map', title: 'The map or directions won’t load', steps: [
    ['Check your signal', 'Maps and new routes need internet. A route you already started keeps working offline.'],
    ['Try again in a minute', 'The free map services are sometimes busy. Your ride still records meanwhile.'],
    ['Clear saved maps', 'If the map looks broken, clear saved maps and reopen it.', { label: 'Offline & storage', run: () => push('storage') }],
  ] },
  { id: 'group', icon: 'group_off', title: 'Group or invite problems', steps: [
    ['Check the code', 'Codes are 6 letters and numbers. The leader can see it in the group → Group info.'],
    ['Code changed?', 'If the leader made a new code, old links and QR codes stop working. Ask for the new one.'],
    ['Group full', 'Groups hold up to 50 riders.'],
  ] },
  { id: 'ride', icon: 'route', title: 'My ride wasn’t saved', steps: [
    ['Very short rides', 'Rides under 50 m aren’t saved.'],
    ['No signal at the end', 'Rides ended offline are kept on your phone and sent when you’re back online.', { label: 'Send unsent rides', run: () => push('storage') }],
    ['App closed mid-ride', 'If the phone closes Rylaide during a ride, that ride can be lost. Keep Rylaide open; the screen stays on while riding.'],
  ] },
  { id: 'battery', icon: 'battery_alert', title: 'Battery drains fast', steps: [
    ['Dim the screen', 'GPS and the screen use the most battery. Lower brightness, or use Night theme.'],
    ['Charge on the bike', 'For long rides, use a USB charger on the handlebar.'],
    ['Close other apps', 'Other navigation or video apps running in the background add up.'],
  ] },
  { id: 'account', icon: 'key', title: 'Signing in on another phone', steps: [
    ['Find your code', 'On your old phone: Settings → Account → Sign in on another phone.', { label: 'Open Account', run: () => push('account') }],
    ['On the new phone', 'Open Rylaide → I already have an account → enter the code.'],
  ] },
  { id: 'refund', icon: 'currency_rupee', title: 'Payments or refunds', email: true },
  { id: 'other', icon: 'help', title: 'Something else', email: true },
];

register('care', (el) => {
  const { body } = page(el, 'Customer care', { back });
  body.append(
    h('div', { class: 'care-hero' }, ic('support_agent', { size: 40 }), h('div', {}, h('div', { class: 'title-l' }, `Hi ${ctx.user.name.split(' ')[0]}, how can we help?`), h('div', { class: 'body-m variant' }, 'Most problems are fixed in a minute with the Rylaide Assistant.'))),
    h('div', { class: 'stack gap8 mt16' },
      button('Ask the Rylaide Assistant', { size: 'large', wide: true, icon: 'smart_toy', onclick: go('assistant') }),
      button('Contact support', { size: 'large', wide: true, style: 'outlined', icon: 'forum', onclick: go('careemail', { topic: 'other' }) })),
    sectionTitle('Common questions'),
    h('div', { class: 'list' }, TOPICS.filter((t) => !t.email).slice(0, 4).map((t) => listItem({ icon: t.icon, title: t.title, trail: ic('chevron_right'), onclick: go('carefix', { topic: t.id }) }))),
    h('p', { class: 'body-s variant', style: 'padding:16px 4px 32px' }, 'Payments and refunds are always handled by Rylaide support, never by the Assistant. We reply within 2 working days.'));
});

// 58b Rylaide Assistant: pick what's wrong → guided fix (58c)
register('assistant', (el) => {
  const { body } = page(el, 'Rylaide Assistant', { back });
  body.append(h('div', { class: 'chat', style: 'padding:8px 0' },
    h('div', { class: 'bubble body-m' }, h('span', { class: 'from label-m', style: 'color:var(--primary)' }, 'Rylaide Assistant'), `Hi ${ctx.user.name.split(' ')[0]}! What’s going wrong? Pick the closest one.`)),
  h('div', { class: 'topic-chips' }, TOPICS.map((t) => h('button', { type: 'button', class: 'chip', 'data-topic': t.id, onclick: () => push(t.email ? 'careemail' : 'carefix', { topic: t.id }) }, ic(t.icon, { size: 18 }), t.title))));
});

// 58c Fix steps → 58e solved or 58d email
register('carefix', (el, params) => {
  const t = TOPICS.find((x) => x.id === params.topic) || TOPICS[0];
  const { body } = page(el, 'Rylaide Assistant', { back });
  body.append(
    h('div', { class: 'chat', style: 'padding:8px 0' },
      h('div', { class: 'bubble mine body-m' }, t.title),
      h('div', { class: 'bubble body-m' }, h('span', { class: 'from label-m', style: 'color:var(--primary)' }, 'Rylaide Assistant'), 'Let’s fix it. Try these in order:')),
    h('ol', { class: 'fix-steps' }, t.steps.map(([title, text, action], i) => h('li', { class: 'card pad' },
      h('span', { class: 'n title-s' }, String(i + 1)),
      h('div', { class: 'main' }, h('div', { class: 'title-s' }, title), h('div', { class: 'body-m variant' }, text),
        action ? button(action.label, { style: 'tonal', attrs: { style: 'margin-top:8px' }, onclick: action.run }) : null)))),
    h('div', { class: 'card pad stack gap12 mt16' }, h('div', { class: 'title-m' }, 'Did this fix it?'),
      h('div', { class: 'row gap8' },
        button('Yes, it’s fixed', { icon: 'check', onclick: () => push('caresolved', { topic: t.id }, { replace: true }) }),
        button('No', { style: 'outlined', onclick: () => push('careemail', { topic: t.id, tried: true }) }))),
    h('div', { style: 'height:32px' }));
});

// 58e Solved
register('caresolved', (el, params) => {
  const t = TOPICS.find((x) => x.id === params.topic);
  el.append(h('div', { class: 'screen-body pad', style: 'display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:12px' },
    h('span', { class: 'solved-mark' }, ic('check', { size: 48 })),
    h('h1', { class: 'headline-m', style: 'margin:8px 0 0' }, 'Glad that’s sorted'),
    h('p', { class: 'body-m variant', style: 'max-width:300px' }, t ? `“${t.title}” is fixed. Ride safe!` : 'Ride safe!')),
  h('div', { class: 'screen-foot stack gap8' }, button('Done', { size: 'large', wide: true, onclick: back }), button('Something else is wrong', { style: 'text', wide: true, onclick: () => push('assistant', {}, { replace: true }) })));
});

// 58d Contact support: the report goes to Rylaide's server (and to the support email once one is set)
register('careemail', (el, params) => {
  const t = TOPICS.find((x) => x.id === params.topic) || TOPICS[TOPICS.length - 1];
  const { body } = page(el, 'Contact support', { back });
  const msg = h('textarea', { rows: 6, maxlength: 2000, placeholder: ' ', name: 'message', style: 'resize:vertical' });
  const msgF = h('label', { class: 'field textarea' }, msg, h('label', {}, 'What happened?'));
  const reply = field({ label: params.signedOut ? 'How can we reach you?' : 'Reply to (optional)', attrs: { maxlength: 120, name: 'contact', autocomplete: 'email' }, support: 'Phone number or email' });
  const u = ctx.user;
  const info = [
    `Topic: ${t.title}`, params.tried ? 'Tried the Assistant’s steps: yes' : null, u ? `Rider: ${u.name} (${u.id})` : 'Not signed in',
    `App: Rylaide ${VERSION}${native() ? ' · Android app' : ' · web'}`, `Phone: ${navigator.userAgent.replace(/\) .*/, ')')}`, `Connection: ${ctx.conn} · GPS: ${ctx.gps || 'unknown'}`,
  ].filter(Boolean).join('\n');
  const send = button('Send to Rylaide support', { size: 'large', wide: true, icon: 'send' });
  send.onclick = () => withLoading(send, async () => {
    if (msg.value.trim().length < 5) { msgF.classList.add('error'); snackbar('Tell us a little about what happened.'); return; }
    if (params.signedOut && reply.input.value.trim().length < 5) return reply.setError('We need a way to reach you.');
    try {
      const r = await api.post('/api/support', { topic: t.id, message: msg.value.trim(), contact: reply.input.value.trim(), info });
      push('caresent', { ref: r.ref }, { replace: true });
    } catch (e) { snackbar(e.message); }
  });
  const mail = supportEmail();
  body.append(
    h('p', { class: 'body-m variant', style: 'margin:8px 0 16px' }, t.id === 'refund' ? 'Payments and refunds are always handled by Rylaide support so we can check the details with you.' : 'Tell us what happened and what you expected. We reply within 2 working days.'),
    h('div', { class: 'list' }, listItem({ icon: t.icon, title: 'About', sub: t.title })),
    h('div', { class: 'mt16 stack gap16' }, msgF, reply),
    h('details', { class: 'body-s variant', style: 'margin:12px 4px' }, h('summary', {}, 'Details we add to help'), h('pre', { style: 'white-space:pre-wrap;font:inherit;margin:8px 0 0' }, info)),
    mail ? h('p', { class: 'body-s variant', style: 'margin:0 4px 24px' }, 'Prefer email? ', h('a', { href: `mailto:${mail}?subject=${encodeURIComponent(`Rylaide: ${t.title}`)}&body=${encodeURIComponent(`\n\n---\n${info}`)}` }, mail)) : null);
  el.append(h('div', { class: 'screen-foot' }, send));
});

register('caresent', (el, params) => {
  el.append(h('div', { class: 'screen-body pad', style: 'display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:12px' },
    h('span', { class: 'solved-mark' }, ic('mark_email_read', { size: 48 })),
    h('h1', { class: 'headline-m', style: 'margin:8px 0 0' }, 'Sent to Rylaide support'),
    h('p', { class: 'body-m variant', style: 'max-width:300px' }, `Your reference is ${params.ref}. We reply within 2 working days.`)),
  h('div', { class: 'screen-foot' }, button('Done', { size: 'large', wide: true, onclick: back })));
});
