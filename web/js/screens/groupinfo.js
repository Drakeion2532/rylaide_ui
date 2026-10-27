// Groups graph (Figma navigation map): G01 Group space → 39 Group info → 41 Members · 39c Expenses · G14 Settings; Invite
import { h, fmtDist, haversine, shareText } from '../util.js';
import { api } from '../api.js';
import { ctx, onMany } from '../state.js';
import { ic, button, iconButton, listItem, avatar, avatarStack, field, sheet, dialog, snackbar, withLoading, page, sectionTitle, rupees, checkbox } from '../ui.js';
import { register, push, back, tab } from '../router.js';
import * as engine from '../engine.js';

const groupFor = (id) => ctx.groups.find((g) => g.id === id);
const isLeader = (g) => g?.ownerId === ctx.user.id;
const firstName = (n = '') => n.split(' ')[0];

// ---------------------------------------------------------------- 39 Group info
register('groupinfo', (el, params) => {
  const { body, setTitle } = page(el, 'Group info', { back });
  let ex = null;
  const render = () => {
    const g = groupFor(params.id);
    if (!g) return;
    setTitle('Group info');
    const me = ex?.balances.find((b) => b.userId === ctx.user.id);
    body.replaceChildren(
      h('div', { class: 'group-head' },
        h('span', { class: 'group-badge' }, ic('groups', { size: 36 })),
        h('h1', { class: 'headline-s', style: 'margin:12px 0 2px' }, g.name),
        h('p', { class: 'body-m variant', style: 'margin:0' }, g.description || `${g.members.length} ${g.members.length === 1 ? 'rider' : 'riders'} · since ${new Date(g.createdAt).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`),
        h('div', { class: 'row gap8', style: 'margin-top:16px;justify-content:center' },
          button('Invite', { style: 'tonal', icon: 'person_add', onclick: () => push('invite', { id: g.id }) }),
          button('Chat', { style: 'tonal', icon: 'forum', onclick: back }))),
      g.live ? h('div', { class: 'banner ok', style: 'margin:16px 0 0' }, ic('two_wheeler'), h('span', { class: 'main' }, h('span', { class: 'title-s' }, `${g.live.byName} is riding${g.live.destination ? ` to ${g.live.destination}` : ''}`), h('span', { class: 'body-m' }, `${g.live.riders.length} in this ride`))) : null,
      h('div', { class: 'list mt16' },
        listItem({ icon: 'group', title: 'Members', sub: g.members.map((m) => firstName(m.name)).join(', '), trail: h('span', { class: 'row gap8' }, avatarStack(g.members.map((m) => m.name), 3), ic('chevron_right')), onclick: () => push('members', { id: g.id }), attrs: { 'data-page': 'members' } }),
        listItem({ icon: 'receipt_long', title: 'Expenses', sub: ex ? (ex.total ? `${rupees(ex.total)} spent${me ? ` · ${me.amount > 0.009 ? `you get back ${rupees(me.amount)}` : me.amount < -0.009 ? `you owe ${rupees(-me.amount)}` : 'you’re settled'}` : ''}` : 'Split fuel, food and tolls') : 'Split fuel, food and tolls', trail: ic('chevron_right'), onclick: () => push('expenses', { id: g.id }), attrs: { 'data-page': 'expenses' } }),
        listItem({ icon: 'qr_code_2', title: 'Group code', sub: g.code, trail: ic('chevron_right'), onclick: () => push('invite', { id: g.id }) }),
        isLeader(g) ? listItem({ icon: 'settings', title: 'Group settings', sub: 'Name, description, code, delete', trail: ic('chevron_right'), onclick: () => push('groupsettings', { id: g.id }), attrs: { 'data-page': 'groupsettings' } }) : null),
      g.plan ? [sectionTitle('Ride plan'), h('div', { class: 'card pad' }, h('div', { class: 'title-m' }, g.plan.destination),
        h('div', { class: 'body-s variant' }, [g.plan.meetAt && `Meet at ${g.plan.meetAt}`, `set by ${g.plan.setBy}`].filter(Boolean).join(' · ')),
        h('div', { class: 'mt8' }, button('Ride there', { style: 'tonal', icon: 'navigation', onclick: () => push('setup', { mode: 'group', quickDest: { name: g.plan.destination, lat: g.plan.lat, lng: g.plan.lng } }) })))] : null,
      h('div', { class: 'mt24', style: 'padding-bottom:32px' }, button('Leave group', { style: 'danger-outlined', wide: true, icon: 'logout', onclick: async () => {
        const solo = g.members.length === 1;
        if (!(await dialog({ title: `Leave ${g.name}?`, body: solo ? 'You’re the only rider, so the group is deleted.' : isLeader(g) ? `${firstName(g.members.find((m) => m.id !== ctx.user.id)?.name)} becomes the leader. You can rejoin with code ${g.code}.` : `You can rejoin any time with code ${g.code}.`, confirm: 'Leave', danger: true }))) return;
        try { await engine.leaveGroup(g); snackbar(`You left ${g.name}`); tab('groups', { force: true }); } catch (e) { snackbar(e.message); }
      } })));
  };
  const loadEx = () => api.get(`/api/groups/${params.id}/expenses`).then((d) => { ex = d; render(); }).catch(() => {});
  render(); loadEx();
  el.onResume = () => { render(); loadEx(); };
  return onMany({ group: render, groups: render, 'group-data': (d) => d.kind === 'expenses' && loadEx() });
});

// ---------------------------------------------------------------- Invite (code, QR, share)
register('invite', (el, params) => {
  const { body } = page(el, 'Invite riders', { back });
  const render = () => {
    const g = groupFor(params.id);
    if (!g) return;
    const url = `${location.origin}/?join=${g.code}`;
    const qr = h('img', { class: 'qr-box', alt: `QR code to join ${g.name}` });
    fetch(`/api/groups/${g.id}/qr.svg`, { headers: { authorization: `Bearer ${api.token}` } }).then((r) => (r.ok ? r.blob() : null)).then((b) => { if (b) qr.src = URL.createObjectURL(b); }).catch(() => {});
    body.replaceChildren(h('div', { class: 'stack gap16', style: 'align-items:center;text-align:center;padding:16px 0 32px' },
      qr,
      h('div', {}, h('div', { class: 'label-l variant' }, 'Group code'), h('button', { type: 'button', class: 'code-big', style: 'border:0;background:none;color:inherit', 'aria-label': `Copy code ${g.code.split('').join(' ')}`, onclick: async () => { try { await navigator.clipboard.writeText(g.code); snackbar('Code copied'); } catch { /* ignore */ } } }, g.code)),
      h('p', { class: 'body-m variant' }, 'Riders scan the QR code, open the link, or type the code in Groups → Join.'),
      button('Share invite', { size: 'large', icon: 'share', wide: true, onclick: async () => {
        if ((await shareText({ title: 'Join my ride', text: `Ride with me on Rylaide. Join “${g.name}” with code ${g.code}`, url })) === 'copied') snackbar('Invite link copied');
      } })));
  };
  render();
  return onMany({ group: render, groups: render });
});

// ---------------------------------------------------------------- 41 Members
register('members', (el, params) => {
  const { body } = page(el, 'Members', { back });
  const render = () => {
    const g = groupFor(params.id);
    if (!g) return;
    const lead = isLeader(g);
    const sorted = [...g.members].sort((a, b) => (b.id === g.ownerId) - (a.id === g.ownerId) || (b.online - a.online) || a.name.localeCompare(b.name));
    body.replaceChildren(
      h('p', { class: 'body-m variant', style: 'margin:8px 4px 12px' }, `${g.members.length} of 50 riders${lead ? ' · tap a rider for options' : ''}`),
      h('div', { class: 'list' }, sorted.map((m) => {
        const me = m.id === ctx.user.id;
        const loc = ctx.group?.id === g.id ? ctx.locs.get(m.id) : null;
        let sub = me ? 'You' : m.online ? 'Online' : 'Offline';
        if (!me && loc && ctx.pos) sub += ` · ${fmtDist(haversine([ctx.pos.lat, ctx.pos.lng], [loc.lat, loc.lng]))} away`;
        if (m.vehicle?.model) sub += ` · ${m.vehicle.model}`;
        return listItem({
          lead: avatar(m.name, { status: m.online || me ? 'connected' : 'off', color: m.color }),
          title: m.name, sub, attrs: { 'data-member': m.id },
          trail: h('span', { class: 'row gap8' }, m.id === g.ownerId ? h('span', { class: 'tag' }, 'Leader') : null, lead && !me ? ic('more_vert') : null),
          onclick: lead && !me ? () => memberSheet(g, m) : undefined,
        });
      })),
      h('div', { class: 'mt16' }, button('Invite riders', { style: 'tonal', icon: 'person_add', wide: true, onclick: () => push('invite', { id: g.id }) })),
      h('div', { style: 'height:32px' }));
  };
  const memberSheet = (g, m) => sheet((close) => h('div', { class: 'stack gap8' },
    h('div', { class: 'row gap12', style: 'align-items:center;margin-bottom:8px' }, avatar(m.name, { size: 'l', color: m.color }), h('div', {}, h('div', { class: 'title-l' }, m.name), h('div', { class: 'body-m variant' }, m.online ? 'Online' : 'Offline'))),
    h('div', { class: 'list' },
      listItem({ icon: 'star', title: 'Make group leader', sub: 'You stay a member', onclick: async () => {
        close();
        if (!(await dialog({ title: `Make ${firstName(m.name)} the leader?`, body: 'They can rename the group, remove riders and delete it. You can’t undo this yourself.', confirm: 'Make leader' }))) return;
        try { await api.post(`/api/groups/${g.id}/leader`, { userId: m.id }); await engine.refreshGroup(g.id); snackbar(`${firstName(m.name)} is now the leader`); } catch (e) { snackbar(e.message); }
      } }),
      listItem({ icon: 'person_remove', title: `Remove ${firstName(m.name)}`, sub: 'They can rejoin only with the group code', cls: 'danger-row', onclick: async () => {
        close();
        if (!(await dialog({ title: `Remove ${m.name}?`, body: 'They leave the group straight away. Make a new code in Group settings if they shouldn’t rejoin.', confirm: 'Remove', danger: true }))) return;
        try { await api.post(`/api/groups/${g.id}/members/${m.id}/remove`); await engine.refreshGroup(g.id); snackbar(`${firstName(m.name)} was removed`); } catch (e) { snackbar(e.message); }
      } }))));
  render();
  return onMany({ group: render, groups: render, loc: render });
});

// ---------------------------------------------------------------- 39c Expenses
register('expenses', (el, params) => {
  const fab = h('button', { type: 'button', class: 'fab', style: 'position:absolute;right:16px;bottom:calc(16px + var(--safe-b));z-index:5', onclick: () => addSheet() }, ic('add'), 'Add expense');
  const { body } = page(el, 'Expenses', { back, foot: fab });
  let data = null;
  const g = () => groupFor(params.id);
  const draw = (d) => {
    data = d;
    const me = d.balances.find((b) => b.userId === ctx.user.id);
    body.replaceChildren(
      h('div', { class: 'expense-hero' },
        h('div', {}, h('div', { class: 'label-l variant' }, 'Group spent'), h('div', { class: 'ride-hero tabular' }, rupees(d.total))),
        me ? h('div', { class: `you-${me.amount > 0.009 ? 'get' : me.amount < -0.009 ? 'owe' : 'even'}` }, h('div', { class: 'label-l' }, me.amount > 0.009 ? 'You get back' : me.amount < -0.009 ? 'You owe' : 'You’re'),
          h('div', { class: 'title-l' }, Math.abs(me.amount) > 0.009 ? rupees(Math.abs(me.amount)) : 'settled')) : null),
      d.settle.length ? [sectionTitle('To settle up'), h('div', { class: 'list' }, d.settle.map((s) => listItem({
        icon: 'swap_horiz', title: `${s.from === ctx.user.id ? 'You' : firstName(s.fromName)} → ${s.to === ctx.user.id ? 'you' : firstName(s.toName)}`, sub: 'Pay by UPI or cash',
        trail: h('span', { class: 'row gap8' }, h('span', { class: 'title-s', style: 'color:var(--on-surface)' }, rupees(s.amount)),
          s.from === ctx.user.id || s.to === ctx.user.id ? button('Paid', { style: 'tonal', onclick: async () => {
            try { draw(await api.post(`/api/groups/${params.id}/expenses`, { settlement: true, amount: s.amount, paidBy: s.from, split: [s.to] })); snackbar('Marked as paid'); } catch (e) { snackbar(e.message); }
          } }) : null),
      })))] : d.expenses.length ? h('div', { class: 'banner ok', style: 'margin:16px 0 0' }, ic('check_circle'), h('span', { class: 'main' }, h('span', { class: 'title-s' }, 'Everyone’s settled up'))) : null,
      sectionTitle('Spending'),
      d.expenses.length ? h('div', { class: 'list' }, d.expenses.map((e) => listItem({
        icon: e.settlement ? 'payments' : EXP_ICON(e.title), title: e.settlement ? `${firstName(e.paidByName)} paid ${firstName(nameIn(e.split[0]))}` : e.title,
        sub: e.settlement ? 'Settled up' : `${e.paidBy === ctx.user.id ? 'You' : firstName(e.paidByName)} paid · split ${e.split.length} way${e.split.length === 1 ? '' : 's'} · ${new Date(e.ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`,
        trail: h('span', { class: 'row gap8' }, h('span', { class: 'title-s', style: 'color:var(--on-surface)' }, rupees(e.amount)),
          (e.createdBy === ctx.user.id || e.paidBy === ctx.user.id || isLeader(g())) ? iconButton('delete', { label: `Delete ${e.title}`, small: true, onclick: async () => {
            try { draw(await api.del(`/api/groups/${params.id}/expenses/${e.id}`)); snackbar('Deleted'); } catch (err) { snackbar(err.message); }
          } }) : null),
      }))) : h('div', { class: 'empty' }, ic('receipt_long'), h('p', { class: 'body-m' }, 'Add fuel, food, tolls or stays. Rylaide works out who owes whom with the fewest payments.')),
      h('div', { style: 'height:96px' }));
  };
  const nameIn = (uid) => data?.balances.find((b) => b.userId === uid)?.name || 'rider';
  const EXP_ICON = (t) => (/fuel|petrol|diesel|charge/i.test(t) ? 'local_gas_station' : /food|lunch|dinner|break|chai|tea|dhaba|snack/i.test(t) ? 'restaurant' : /toll/i.test(t) ? 'toll' : /stay|hotel|room|camp/i.test(t) ? 'hotel' : /repair|puncture|mechanic/i.test(t) ? 'build' : 'receipt');
  const addSheet = () => sheet((close) => {
    const grp = g();
    const title = field({ label: 'What for', attrs: { maxlength: 60, name: 'title', list: 'exp-sugg' }, onSurface: true });
    const amount = field({ label: 'Amount (₹)', type: 'number', attrs: { inputmode: 'decimal', min: 1, step: '0.01', name: 'amount' }, onSurface: true });
    const sugg = h('datalist', { id: 'exp-sugg' }, ['Fuel', 'Breakfast', 'Lunch', 'Dinner', 'Chai', 'Toll', 'Stay', 'Parking', 'Puncture repair'].map((v) => h('option', { value: v })));
    const payer = h('select', { 'aria-label': 'Paid by', name: 'paidBy' }, grp.members.map((m) => h('option', { value: m.id, selected: m.id === ctx.user.id }, m.id === ctx.user.id ? 'You' : m.name)));
    const split = new Set(grp.members.map((m) => m.id));
    const each = h('span', { class: 'body-s variant' });
    const upd = () => { const a = Number(amount.input.value); each.textContent = a > 0 && split.size ? `${rupees(a / split.size)} each` : ''; };
    amount.input.addEventListener('input', upd);
    const go = button('Add expense', { size: 'large', wide: true, type: 'submit' });
    setTimeout(() => title.input.focus(), 320);
    return h('form', { class: 'stack gap16', novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      await withLoading(go, async () => {
        try { draw(await api.post(`/api/groups/${params.id}/expenses`, { title: title.input.value, amount: amount.input.value, paidBy: payer.value, split: [...split] })); close(); snackbar('Expense added'); } catch (err) { amount.setError(err.message); }
      });
    } }, h('h2', { class: 'headline-s' }, 'Add expense'), sugg, title, amount,
      h('label', { class: 'field on-surface' }, payer, h('label', {}, 'Paid by')),
      h('div', { class: 'row', style: 'justify-content:space-between' }, h('span', { class: 'title-s' }, 'Split between'), each),
      h('div', { class: 'list' }, grp.members.map((m) => h('label', { class: 'list-item switch-row', style: 'cursor:pointer' }, checkbox({ checked: true, label: m.name, onchange: (v) => { v ? split.add(m.id) : split.delete(m.id); upd(); } }), h('span', { class: 'main' }, h('span', { class: 'body-l' }, m.id === ctx.user.id ? 'You' : m.name))))),
      go);
  });
  body.append(h('div', { class: 'empty' }, h('span', { class: 'spinner' })));
  const load = () => api.get(`/api/groups/${params.id}/expenses`).then(draw).catch((e) => body.replaceChildren(h('div', { class: 'empty' }, ic('cloud_off'), h('p', { class: 'body-m' }, e.message))));
  load();
  return onMany({ 'group-data': (d) => d.kind === 'expenses' && d.groupId === params.id && load() });
});

// ---------------------------------------------------------------- G14 Group settings (leader)
register('groupsettings', (el, params) => {
  const { body } = page(el, 'Group settings', { back });
  const g = groupFor(params.id);
  if (!g) return;
  const name = field({ label: 'Group name', value: g.name, attrs: { maxlength: 40, name: 'name' } });
  const desc = field({ label: 'Description', value: g.description || '', attrs: { maxlength: 200, name: 'description' }, support: 'Like “Sunday morning rides from Pune”' });
  const save = button('Save', { style: 'tonal', type: 'submit' });
  body.append(
    h('form', { class: 'stack gap12 mt8', onsubmit: async (e) => {
      e.preventDefault();
      await withLoading(save, async () => {
        try { await api.patch(`/api/groups/${g.id}`, { name: name.input.value, description: desc.input.value }); await engine.refreshGroup(g.id); snackbar('Group saved'); } catch (err) { name.setError(err.message); }
      });
    } }, name, desc, h('div', {}, save)),
    sectionTitle('Invites'),
    h('div', { class: 'list' }, listItem({ icon: 'autorenew', title: 'Make a new group code', sub: 'Old codes, links and QR codes stop working', onclick: async () => {
      if (!(await dialog({ title: 'Make a new code?', body: 'Riders already in the group stay. Anyone with the old code or link can’t join any more.', confirm: 'New code' }))) return;
      try { const r = await api.post(`/api/groups/${g.id}/code`); await engine.refreshGroup(g.id); snackbar(`New code: ${r.group.code}`); } catch (e) { snackbar(e.message); }
    } })),
    sectionTitle('Danger zone'),
    h('div', { class: 'list' }, listItem({ icon: 'delete_forever', title: 'Delete group', sub: 'Removes chat, expenses and shared places for everyone', cls: 'danger-row', onclick: async () => {
      if (!(await dialog({ title: `Delete ${g.name}?`, body: 'Everyone is taken out of the group and its chat, expenses and shared places are deleted. This can’t be undone.', confirm: 'Delete group', danger: true }))) return;
      try {
        await api.del(`/api/groups/${g.id}`);
        ctx.groups = ctx.groups.filter((x) => x.id !== g.id);
        if (ctx.group?.id === g.id) engine.openGroup(ctx.groups[0] || null);
        snackbar(`${g.name} deleted`);
        tab('groups', { force: true });
      } catch (e) { snackbar(e.message); }
    } })),
    h('div', { style: 'height:32px' }));
});
