// 38 My groups → G01 Group space (Chat · Rides · Members · Shared are tabs) → 39 Group info (groupinfo.js) · 16 Nearby
import { h, fmtDist, haversine, fmtTime, fmtKm, durShort, shareText } from '../util.js';
import { api } from '../api.js';
import { ctx, rt, on, onMany } from '../state.js';
import { ic, button, iconButton, listItem, avatar, avatarStack, field, sheet, dialog, snackbar, segmented, withLoading, liftOnScroll, sectionTitle, page } from '../ui.js';
import { register, push, back, upTo } from '../router.js';
import * as engine from '../engine.js';

export function newGroupSheet({ stay } = {}) {
  if (!stay) { push('newgroup'); return; } // 40 New group flow (full screen); the sheet stays for quick creation inside ride setup
  sheet((close) => {
    const name = field({ label: 'Group name', attrs: { maxlength: 40 }, support: 'For example Weekend Riders', onSurface: true });
    const go = button('Create group', { size: 'large', wide: true, type: 'submit' });
    setTimeout(() => name.input.focus(), 320);
    return h('form', { class: 'stack gap16', onsubmit: async (e) => {
      e.preventDefault();
      if (!name.input.value.trim()) return name.setError('Give the group a name.');
      await withLoading(go, async () => {
        try { const g = await engine.createGroup(name.input.value); close(); if (!stay) push('group', { id: g.id, tab: 'invite' }); snackbar(`${g.name} created. Share code ${g.code} with your riders.`); } catch (err) { name.setError(err.message); }
      });
    } }, h('h2', { class: 'headline-s' }, 'New group'), name, go);
  });
}
export function joinSheet({ stay } = {}) {
  sheet((close) => {
    const code = field({ label: 'Group code', attrs: { maxlength: 9, autocapitalize: 'characters', style: 'text-transform:uppercase;letter-spacing:4px' }, support: '6 letters, from your group leader', onSurface: true });
    const go = button('Join group', { size: 'large', wide: true, type: 'submit' });
    setTimeout(() => code.input.focus(), 320);
    return h('form', { class: 'stack gap16', onsubmit: async (e) => {
      e.preventDefault();
      await withLoading(go, async () => {
        try { const g = await engine.joinGroup(code.input.value); close(); snackbar(`You joined ${g.name}`); if (!stay) push('group', { id: g.id }); } catch (err) { code.setError(err.message); }
      });
    } }, h('h2', { class: 'headline-s' }, 'Join a group'), code, go);
  });
}

register('groups', (el) => {
  const bar = h('header', { class: 'topbar' }, h('h1', { class: 'title title-l', style: 'padding-left:12px' }, 'Groups'), iconButton('qr_code_scanner', { label: 'Join with a code', onclick: () => joinSheet() }));
  const body = h('div', { class: 'screen-body pad' });
  const fab = h('button', { type: 'button', class: 'fab', style: 'position:absolute;right:16px;bottom:16px;z-index:5', onclick: () => newGroupSheet() }, ic('add'), 'New group');
  el.append(bar, body, fab);
  liftOnScroll(bar, body);
  const render = () => {
    if (!ctx.groups.length) {
      body.replaceChildren(h('div', { class: 'empty' }, ic('groups'), h('p', { class: 'title-m', style: 'color:var(--on-surface)' }, 'No groups yet'),
        h('p', { class: 'body-m' }, 'Start a group and share the code, or join one with a code from your leader.'),
        h('div', { class: 'row gap8' }, button('Join with a code', { style: 'outlined', onclick: () => joinSheet() }), button('New group', { onclick: () => newGroupSheet() })),
        button('Find riders nearby', { style: 'text', icon: 'nearby', onclick: () => push('nearby') })));
      return;
    }
    body.replaceChildren(h('div', { class: 'list', style: 'margin-top:8px' }, ctx.groups.map((g) => listItem({
      title: g.name, sub: `${g.members.length} ${g.members.length === 1 ? 'rider' : 'riders'}${g.id === ctx.group?.id ? ' · Current' : ''}`,
      trail: h('span', { class: 'row gap8' }, avatarStack(g.members.map((m) => m.name), 3), ic('chevron_right')),
      onclick: () => { engine.openGroup(g); push('group', { id: g.id }); },
    }))), h('button', { type: 'button', class: 'shortcut', onclick: () => joinSheet() }, ic('group_add'), h('span', { class: 'main' }, h('span', { class: 'title-s' }, 'Join with a code'), h('span', { class: 'body-s variant' }, 'Or open an invite link from your group')), ic('chevron_right')),
      h('button', { type: 'button', class: 'shortcut', onclick: () => push('nearby') }, ic('nearby'), h('span', { class: 'main' }, h('span', { class: 'title-s' }, 'Riders nearby'), h('span', { class: 'body-s variant' }, 'Make a group with riders right here, no code')), ic('chevron_right')), h('div', { style: 'height:80px' }));
  };
  render();
  return onMany({ groups: render, group: render });
});

register('group', (el, params) => {
  const g0 = ctx.groups.find((g) => g.id === params.id);
  if (!g0) { setTimeout(back, 0); return; }
  if (ctx.group?.id !== g0.id) engine.openGroup(g0);
  let view = { invite: 'members', riders: 'members' }[params.tab] || params.tab || 'chat';
  if (params.tab === 'invite') setTimeout(() => push('invite', { id: g0.id }), 0);
  const title = h('button', { type: 'button', class: 'title title-l group-title', 'aria-label': 'Group info', onclick: () => push('groupinfo', { id: g0.id }) }, g0.name);
  const bar = h('header', { class: 'topbar' }, iconButton('arrow_back', { label: 'Back', onclick: () => upTo('groups') }), title, // G01 → 38
    iconButton('person_add', { label: 'Invite riders', onclick: () => push('invite', { id: g0.id }) }),
    iconButton('info', { label: 'Group info', onclick: () => push('groupinfo', { id: g0.id }) }));
  const seg = segmented([{ value: 'chat', label: 'Chat' }, { value: 'rides', label: 'Rides' }, { value: 'members', label: 'Members' }, { value: 'shared', label: 'Shared' }], view, (v) => show(v), { label: 'Group sections' });
  const content = h('div', { class: 'screen-body' });
  const foot = h('div');
  el.append(bar, h('div', { style: 'padding:0 16px 8px' }, seg), content, foot);
  liftOnScroll(bar, content);

  // ---- chat
  const chatList = h('div', { class: 'chat', 'aria-live': 'polite' });
  const typing = h('div', { class: 'body-s variant', style: 'padding:0 16px;min-height:16px' });
  const input = h('input', { 'aria-label': 'Message', placeholder: 'Message the group', maxlength: 1000, enterkeyhint: 'send' });
  let lastTyping = 0;
  input.addEventListener('input', () => { if (Date.now() - lastTyping > 2500) { lastTyping = Date.now(); rt.send({ t: 'typing' }); } });
  const composer = h('form', { class: 'composer', onsubmit: (e) => {
    e.preventDefault();
    const t = input.value.trim();
    if (!t) return;
    if (!rt.send({ t: 'chat', text: t })) return snackbar('You’re offline. Your message wasn’t sent.');
    input.value = '';
  } }, input, iconButton('send', { label: 'Send', style: 'filled', attrs: { type: 'submit' } }));
  const bubble = (m) => {
    const mine = m.userId === ctx.user.id;
    if (m.type === 'system') return h('div', { class: 'bubble system body-s', 'data-id': m.id }, m.text);
    return h('div', { class: `bubble body-m${mine ? ' mine' : ''}${m.type === 'voice' ? ' voice' : ''}`, 'data-id': m.id },
      !mine ? h('span', { class: 'from label-m', style: `color:${m.color || 'var(--primary)'}` }, m.name) : null,
      m.type === 'voice' ? ic('mic') : null, m.text, h('span', { class: 'time body-s' }, fmtTime(m.ts)));
  };
  const renderChat = () => {
    chatList.replaceChildren(...(ctx.messages.length ? ctx.messages.map(bubble) : [h('div', { class: 'empty' }, ic('forum'), h('p', { class: 'body-m' }, 'No messages yet. Say hi, or hold the mic during a ride to talk.'))]));
    requestAnimationFrame(() => (content.scrollTop = content.scrollHeight));
  };

  // ---- members (live status; full list and leader tools in 41 Members)
  const renderRiders = () => {
    const g = ctx.group;
    if (!g) return;
    content.replaceChildren(h('div', { style: 'padding:8px 16px 24px' },
      g.live ? h('button', { type: 'button', class: 'banner ok', style: 'margin:0 0 12px;width:100%;border:0;text-align:left', onclick: () => push('setup', g.live.lat != null ? { mode: 'group', quickDest: { name: g.live.destination, lat: g.live.lat, lng: g.live.lng } } : { mode: 'group' }) },
        ic('two_wheeler'), h('span', { class: 'main' }, h('span', { class: 'title-s' }, `${g.live.byName} is riding${g.live.destination ? ` to ${g.live.destination}` : ''}`), h('span', { class: 'body-m' }, 'Tap to join this ride'))) : null,
      h('div', { class: 'list' }, [...g.members].sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name)).map((m) => {
        const me = m.id === ctx.user.id;
        const loc = ctx.locs.get(m.id);
        let sub = me ? 'You' : m.online ? 'Online' : 'Offline';
        if (!me && loc && ctx.pos) sub += ` · ${fmtDist(haversine([ctx.pos.lat, ctx.pos.lng], [loc.lat, loc.lng]))} away`;
        if (g.live?.riders.includes(m.id)) sub += ' · riding';
        if (ctx.sos.has(m.id)) sub = 'SOS active';
        return listItem({
          lead: avatar(m.name, { status: ctx.sos.has(m.id) ? 'off' : engine.isSpeaking(m.id) ? 'speaking' : (m.online || me) ? 'connected' : 'off', color: m.color }),
          title: `${m.name}${m.id === g.ownerId ? ' · Leader' : ''}`, sub,
          trail: loc && !me ? button('Find', { style: 'text', onclick: () => push('ridemap', { focus: loc }) }) : null,
          cls: ctx.sos.has(m.id) ? 'alert' : '',
        });
      })),
      h('div', { class: 'row gap8 mt16' }, button('Invite', { style: 'tonal', icon: 'person_add', onclick: () => push('invite', { id: g.id }) }), button('Group info', { style: 'text', icon: 'info', onclick: () => push('groupinfo', { id: g.id }) }))));
  };

  // ---- rides (rides recorded with this group)
  const renderRides = async () => {
    content.replaceChildren(h('div', { class: 'empty' }, h('span', { class: 'spinner' })));
    try {
      const { rides } = await api.get(`/api/groups/${params.id}/rides`);
      if (view !== 'rides') return;
      content.replaceChildren(h('div', { style: 'padding:8px 16px 24px' }, rides.length
        ? h('div', { class: 'list' }, rides.map((r) => listItem({
          icon: 'route', title: r.destination || r.name, sub: `${r.mine ? 'You' : r.riderName} · ${fmtKm(r.distance)} km · ${durShort(r.duration)}`,
          trail: h('span', { class: 'row gap8' }, new Date(r.startedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), ic('chevron_right')),
          onclick: () => push('summary', r.mine ? { id: r.id } : { ride: { ...r, id: null, points: [] } }),
        })))
        : h('div', { class: 'empty' }, ic('route'), h('p', { class: 'title-m', style: 'color:var(--on-surface)' }, 'No group rides yet'), h('p', { class: 'body-m' }, 'Rides you take as a group ride show here for everyone.'), button('Start a group ride', { onclick: () => push('setup', { mode: 'group' }) }))));
    } catch (e) { content.replaceChildren(h('div', { class: 'empty' }, ic('cloud_off'), h('p', { class: 'body-m' }, e.message))); }
  };

  // ---- shared places
  const KIND = { meet: ['Meet point', 'flag'], fuel: ['Fuel', 'local_gas_station'], food: ['Food', 'restaurant'], view: ['Viewpoint', 'landscape'], stay: ['Stay', 'hotel'], repair: ['Repair', 'build'], other: ['Place', 'place'] };
  const renderShared = async () => {
    content.replaceChildren(h('div', { class: 'empty' }, h('span', { class: 'spinner' })));
    try {
      const { shared } = await api.get(`/api/groups/${params.id}/shared`);
      if (view !== 'shared') return;
      const lead = ctx.group?.ownerId === ctx.user.id;
      content.replaceChildren(h('div', { style: 'padding:8px 16px 24px' },
        button('Share a place', { icon: 'add_location_alt', wide: true, onclick: () => shareSheet() }),
        shared.length ? [sectionTitle('Saved by the group', `${shared.length}`), h('div', { class: 'list' }, shared.map((p) => listItem({
          icon: KIND[p.kind]?.[1] || 'place', title: p.name,
          sub: [KIND[p.kind]?.[0], p.note, `${p.by === ctx.user.id ? 'you' : p.byName}`, ctx.pos ? fmtDist(haversine([ctx.pos.lat, ctx.pos.lng], [p.lat, p.lng])).replace('now', 'here') : null].filter(Boolean).join(' · '),
          trail: h('span', { class: 'row gap8' },
            iconButton('navigation', { label: `Ride to ${p.name}`, small: true, onclick: () => push('setup', { mode: 'group', quickDest: { name: p.name, lat: p.lat, lng: p.lng } }) }),
            p.by === ctx.user.id || lead ? iconButton('delete', { label: `Remove ${p.name}`, small: true, onclick: async () => {
              try { await api.del(`/api/groups/${params.id}/shared/${p.id}`); renderShared(); } catch (e) { snackbar(e.message); }
            } }) : null),
        })))] : h('div', { class: 'empty', style: 'padding-top:24px' }, ic('add_location_alt'), h('p', { class: 'body-m' }, 'Share meet points, fuel stops, dhabas and viewpoints so the whole group can ride there.'))));
    } catch (e) { content.replaceChildren(h('div', { class: 'empty' }, ic('cloud_off'), h('p', { class: 'body-m' }, e.message))); }
  };
  const shareSheet = (pre = {}) => sheet((close) => {
    let kind = pre.kind || 'meet';
    const place = pre.place || null;
    const name = field({ label: 'Name', value: pre.name || (place ? engine.short(place.name) : ''), attrs: { maxlength: 80, name: 'name' }, onSurface: true });
    const note = field({ label: 'Note', value: pre.note || '', attrs: { maxlength: 200, name: 'note' }, onSurface: true, support: 'Optional, like “parking behind the pump”' });
    const where = h('div', { class: 'body-m variant' }, place ? engine.short(place.name) : ctx.pos ? 'Where you are now' : 'Waiting for your location…');
    const chips = h('div', { class: 'row gap8', style: 'flex-wrap:wrap' });
    const drawChips = () => chips.replaceChildren(...Object.entries(KIND).map(([k, [l, icn]]) => h('button', { type: 'button', class: `chip${kind === k ? ' on' : ''}`, 'aria-pressed': String(kind === k), onclick: () => { kind = k; drawChips(); } }, ic(icn, { size: 18 }), l)));
    drawChips();
    const pick = button(place ? 'Change' : 'Pick on the map', { style: 'text', icon: 'pin_drop', onclick: () => {
      const keep = { kind, name: name.input.value, note: note.input.value };
      close();
      push('pin', { title: 'Share a place', start: place, onPick: (p) => setTimeout(() => shareSheet({ ...keep, place: p, name: keep.name || engine.short(p.name) }), 350) });
    } });
    const go = button('Share with the group', { size: 'large', wide: true, type: 'submit' });
    return h('form', { class: 'stack gap16', novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      const p = place || (ctx.pos ? { lat: ctx.pos.lat, lng: ctx.pos.lng } : null);
      if (!p) return name.setError('Waiting for your location. Or pick a place on the map.');
      await withLoading(go, async () => {
        try { await api.post(`/api/groups/${params.id}/shared`, { name: name.input.value, note: note.input.value, kind, lat: p.lat, lng: p.lng }); close(); snackbar('Shared with the group'); if (view === 'shared') renderShared(); } catch (err) { name.setError(err.message); }
      });
    } }, h('h2', { class: 'headline-s' }, 'Share a place'), chips, name, note, h('div', { class: 'row', style: 'justify-content:space-between;align-items:center' }, h('div', { class: 'row gap8' }, ic(place ? 'location_on' : 'my_location', { size: 18 }), where), pick), go);
  });

  const show = (v) => {
    view = v;
    ctx.chatOpen = v === 'chat';
    if (v === 'chat') { ctx.unread = 0; content.replaceChildren(chatList, typing); foot.replaceChildren(composer); renderChat(); }
    else { foot.replaceChildren(); ({ members: renderRiders, rides: renderRides, shared: renderShared })[v](); }
  };
  show(view);
  const offs = onMany({
    chat: (m) => { if (view === 'chat') { chatList.querySelector('.empty')?.remove(); if (!chatList.querySelector(`[data-id="${m.id}"]`)) chatList.append(bubble(m)); content.scrollTop = content.scrollHeight; } },
    messages: () => view === 'chat' && renderChat(),
    typing: (m) => { typing.textContent = `${m.name} is typing…`; clearTimeout(typing.t); typing.t = setTimeout(() => (typing.textContent = ''), 3000); },
    group: (g) => { if (!g || g.id !== params.id) return; title.textContent = g.name; if (view === 'members') renderRiders(); },
    loc: () => view === 'members' && renderRiders(),
    speaking: () => view === 'members' && renderRiders(),
    'group-data': (d) => d.groupId === params.id && d.kind === 'shared' && view === 'shared' && renderShared(),
  });
  return () => { ctx.chatOpen = false; offs(); };
});

// ---------------------------------------------------------------- 40 New group → 40b Invite riders → G01 (Up: → 38)
register('newgroup', (el) => {
  const { body, setTitle } = page(el, 'New group', { back });
  const steps = h('div', { class: 'steps-bar', 'aria-hidden': 'true', style: 'margin:0 16px' }, h('i', { class: 'on' }), h('i'));
  el.insertBefore(steps, body);
  const name = field({ label: 'Group name', attrs: { maxlength: 40, name: 'name' }, support: 'For example Weekend Riders' });
  const desc = field({ label: 'Description', attrs: { maxlength: 200, name: 'description' }, support: 'Optional: where and when you ride' });
  const go = button('Create group', { size: 'large', wide: true, type: 'submit' });
  body.append(h('form', { class: 'stack gap16', style: 'margin-top:16px', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    if (!name.input.value.trim()) return name.setError('Give the group a name.');
    await withLoading(go, async () => {
      try {
        const g = await engine.createGroup(name.input.value);
        if (desc.input.value.trim()) { try { await api.patch(`/api/groups/${g.id}`, { description: desc.input.value }); await engine.refreshGroup(g.id); } catch { /* optional */ } }
        invite(g);
      } catch (err) { name.setError(err.message); }
    });
  } }, h('h1', { class: 'headline-m', style: 'margin:0' }, 'Name your group'), name, desc, go));
  setTimeout(() => name.input.focus(), 350);
  const invite = (g) => {
    setTitle('Invite riders');
    steps.lastChild.classList.add('on');
    const qr = h('img', { class: 'qr-box', alt: `QR code to join ${g.name}` });
    fetch(`/api/groups/${g.id}/qr.svg`, { headers: { authorization: `Bearer ${api.token}` } }).then((r) => (r.ok ? r.blob() : null)).then((b) => { if (b) qr.src = URL.createObjectURL(b); }).catch(() => {});
    body.replaceChildren(h('div', { class: 'stack gap16 step-in-fwd', style: 'align-items:center;text-align:center;padding:16px 0 32px', 'data-invite': '' },
      h('h1', { class: 'headline-m', style: 'margin:0' }, `${g.name} is ready`), qr,
      h('div', {}, h('div', { class: 'label-l variant' }, 'Group code'), h('div', { class: 'code-big' }, g.code)),
      h('p', { class: 'body-m variant' }, 'Riders scan the QR code, open the link, or type the code in Groups → Join.'),
      button('Share invite', { size: 'large', icon: 'share', wide: true, onclick: async () => {
        if ((await shareText({ title: 'Join my ride', text: `Ride with me on Rylaide. Join “${g.name}” with code ${g.code}`, url: `${location.origin}/?join=${g.code}` })) === 'copied') snackbar('Invite link copied');
      } })));
    el.append(h('div', { class: 'screen-foot' }, button('Go to the group', { size: 'large', wide: true, style: 'tonal', onclick: () => push('group', { id: g.id }, { replace: true }) })));
  };
});
