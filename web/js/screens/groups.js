// 38 My groups → G01 Group space (Chat · Riders · Invite)
import { h, fmtDist, haversine, fmtTime } from '../util.js';
import { api } from '../api.js';
import { ctx, rt, on, onMany } from '../state.js';
import { ic, button, iconButton, listItem, avatar, avatarStack, field, sheet, dialog, snackbar, segmented, withLoading, liftOnScroll } from '../ui.js';
import { register, push, back } from '../router.js';
import * as engine from '../engine.js';

function newGroupSheet() {
  sheet((close) => {
    const name = field({ label: 'Group name', attrs: { maxlength: 40 }, support: 'For example Weekend Riders', onSurface: true });
    const go = button('Create group', { size: 'large', wide: true, type: 'submit' });
    setTimeout(() => name.input.focus(), 320);
    return h('form', { class: 'stack gap16', onsubmit: async (e) => {
      e.preventDefault();
      if (!name.input.value.trim()) return name.setError('Give the group a name.');
      await withLoading(go, async () => {
        try { const g = await engine.createGroup(name.input.value); close(); push('group', { id: g.id, tab: 'invite' }); snackbar('Group created. Invite your riders.'); } catch (err) { name.setError(err.message); }
      });
    } }, h('h2', { class: 'headline-s' }, 'New group'), name, go);
  });
}
export function joinSheet() {
  sheet((close) => {
    const code = field({ label: 'Group code', attrs: { maxlength: 9, autocapitalize: 'characters', style: 'text-transform:uppercase;letter-spacing:4px' }, support: '6 letters, from your group leader', onSurface: true });
    const go = button('Join group', { size: 'large', wide: true, type: 'submit' });
    setTimeout(() => code.input.focus(), 320);
    return h('form', { class: 'stack gap16', onsubmit: async (e) => {
      e.preventDefault();
      await withLoading(go, async () => {
        try { const g = await engine.joinGroup(code.input.value); close(); snackbar(`You joined ${g.name}`); push('group', { id: g.id }); } catch (err) { code.setError(err.message); }
      });
    } }, h('h2', { class: 'headline-s' }, 'Join a group'), code, go);
  });
}

register('groups', (el) => {
  const bar = h('header', { class: 'topbar' }, h('h1', { class: 'title title-l', style: 'padding-left:12px' }, 'Groups'), iconButton('qr_code_scanner', { label: 'Join with a code', onclick: joinSheet }));
  const body = h('div', { class: 'screen-body pad' });
  const fab = h('button', { type: 'button', class: 'fab', style: 'position:absolute;right:16px;bottom:16px;z-index:5', onclick: newGroupSheet }, ic('add'), 'New group');
  el.append(bar, body, fab);
  liftOnScroll(bar, body);
  const render = () => {
    if (!ctx.groups.length) {
      body.replaceChildren(h('div', { class: 'empty' }, ic('groups'), h('p', { class: 'title-m', style: 'color:var(--on-surface)' }, 'No groups yet'),
        h('p', { class: 'body-m' }, 'Start a group and share the code, or join one with a code from your leader.'),
        h('div', { class: 'row gap8' }, button('Join with a code', { style: 'outlined', onclick: joinSheet }), button('New group', { onclick: newGroupSheet }))));
      return;
    }
    body.replaceChildren(h('div', { class: 'list', style: 'margin-top:8px' }, ctx.groups.map((g) => listItem({
      title: g.name, sub: `${g.members.length} ${g.members.length === 1 ? 'rider' : 'riders'}${g.id === ctx.group?.id ? ' · Current' : ''}`,
      trail: h('span', { class: 'row gap8' }, avatarStack(g.members.map((m) => m.name), 3), ic('chevron_right')),
      onclick: () => { engine.openGroup(g); push('group', { id: g.id }); },
    }))), h('button', { type: 'button', class: 'shortcut', onclick: joinSheet }, ic('group_add'), h('span', { class: 'main' }, h('span', { class: 'title-s' }, 'Join with a code'), h('span', { class: 'body-s variant' }, 'Or open an invite link from your group')), ic('chevron_right')), h('div', { style: 'height:80px' }));
  };
  render();
  return onMany({ groups: render, group: render });
});

register('group', (el, params) => {
  const g0 = ctx.groups.find((g) => g.id === params.id);
  if (!g0) { setTimeout(back, 0); return; }
  if (ctx.group?.id !== g0.id) engine.openGroup(g0);
  let view = params.tab || 'chat';
  const title = h('h1', { class: 'title title-l' }, g0.name);
  const bar = h('header', { class: 'topbar' }, iconButton('arrow_back', { label: 'Back', onclick: back }), title,
    iconButton('person_add', { label: 'Invite riders', onclick: () => { seg.set('invite'); show('invite'); } }));
  const seg = segmented([{ value: 'chat', label: 'Chat' }, { value: 'riders', label: 'Riders' }, { value: 'invite', label: 'Invite' }], view, (v) => show(v), { label: 'Group sections' });
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

  // ---- riders
  const renderRiders = () => {
    const g = ctx.group;
    content.replaceChildren(h('div', { style: 'padding:8px 16px 24px' },
      h('div', { class: 'list' }, [...g.members].sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name)).map((m) => {
        const me = m.id === ctx.user.id;
        const loc = ctx.locs.get(m.id);
        let sub = me ? 'You' : m.online ? 'Online' : 'Offline';
        if (!me && loc && ctx.pos) sub += ` · ${fmtDist(haversine([ctx.pos.lat, ctx.pos.lng], [loc.lat, loc.lng]))} away`;
        if (ctx.sos.has(m.id)) sub = 'SOS active';
        return listItem({
          lead: avatar(m.name, { status: ctx.sos.has(m.id) ? 'off' : ctx.speaking === m.id ? 'speaking' : (m.online || me) ? 'connected' : 'off' }),
          title: `${m.name}${m.id === g.ownerId ? ' · Leader' : ''}`, sub,
          trail: loc && !me ? button('Find', { style: 'text', onclick: () => push('ridemap', { focus: loc }) }) : null,
          cls: ctx.sos.has(m.id) ? 'alert' : '',
        });
      })),
      h('div', { class: 'mt24' }, button('Leave group', { style: 'danger-outlined', wide: true, icon: 'logout', onclick: async () => {
        if (!(await dialog({ title: `Leave ${g.name}?`, body: `You can rejoin any time with code ${g.code}.`, confirm: 'Leave', danger: true }))) return;
        try { await engine.leaveGroup(g); snackbar(`You left ${g.name}`); back(); } catch (e) { snackbar(e.message); }
      } }))));
  };

  // ---- invite
  const renderInvite = () => {
    const g = ctx.group;
    const url = `${location.origin}/?join=${g.code}`;
    const qr = h('img', { class: 'qr-box', alt: `QR code to join ${g.name}` });
    fetch(`/api/groups/${g.id}/qr.svg`, { headers: { authorization: `Bearer ${api.token}` } }).then((r) => (r.ok ? r.blob() : null)).then((b) => { if (b) qr.src = URL.createObjectURL(b); }).catch(() => {});
    const share = async () => {
      const text = `Ride with me on Rylaide. Join “${g.name}” with code ${g.code}`;
      if (navigator.share) { try { await navigator.share({ title: 'Join my ride', text, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
      try { await navigator.clipboard.writeText(`${text}: ${url}`); snackbar('Invite link copied'); } catch { prompt('Copy this invite:', url); }
    };
    content.replaceChildren(h('div', { class: 'stack gap16', style: 'align-items:center;text-align:center;padding:16px 16px 32px' },
      qr,
      h('div', {}, h('div', { class: 'label-l variant' }, 'Group code'), h('button', { type: 'button', class: 'code-big', style: 'border:0;background:none;color:inherit', 'aria-label': `Copy code ${g.code.split('').join(' ')}`, onclick: async () => { try { await navigator.clipboard.writeText(g.code); snackbar('Code copied'); } catch { /* ignore */ } } }, g.code)),
      h('p', { class: 'body-m variant' }, 'Riders scan the QR code, open the link, or type the code in Groups → Join.'),
      button('Share invite', { size: 'large', icon: 'share', onclick: share, wide: true }),
      g.plan ? h('div', { class: 'card pad', style: 'width:100%;text-align:left' }, h('div', { class: 'label-m variant' }, 'Ride plan'), h('div', { class: 'title-m' }, g.plan.destination),
        h('div', { class: 'body-s variant' }, [g.plan.meetAt && `Meet at ${g.plan.meetAt}`, `set by ${g.plan.setBy}`].filter(Boolean).join(' · ')),
        h('div', { class: 'mt8' }, button('Ride there', { style: 'tonal', icon: 'navigation', onclick: () => push('setup', { quickDest: { name: g.plan.destination, lat: g.plan.lat, lng: g.plan.lng } }) }))) : null));
  };

  const show = (v) => {
    view = v;
    ctx.chatOpen = v === 'chat';
    if (v === 'chat') { ctx.unread = 0; content.replaceChildren(chatList, typing); foot.replaceChildren(composer); renderChat(); }
    else { foot.replaceChildren(); v === 'riders' ? renderRiders() : renderInvite(); }
  };
  show(view);
  const offs = onMany({
    chat: (m) => { if (view === 'chat') { chatList.querySelector('.empty')?.remove(); if (!chatList.querySelector(`[data-id="${m.id}"]`)) chatList.append(bubble(m)); content.scrollTop = content.scrollHeight; } },
    messages: () => view === 'chat' && renderChat(),
    typing: (m) => { typing.textContent = `${m.name} is typing…`; clearTimeout(typing.t); typing.t = setTimeout(() => (typing.textContent = ''), 3000); },
    group: (g) => { if (!g || g.id !== params.id) return; title.textContent = g.name; if (view === 'riders') renderRiders(); },
    loc: () => view === 'riders' && renderRiders(),
    speaking: () => view === 'riders' && renderRiders(),
  });
  return () => { ctx.chatOpen = false; offs(); };
});
