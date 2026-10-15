// 08 — Home
import { h, fmtDay, fmtInt, fmtKm, durShort, localDate } from '../util.js';
import { api } from '../api.js';
import { ctx, onMany } from '../state.js';
import { ic, button, iconButton, avatar, avatarStack } from '../ui.js';
import { register, push, tab } from '../router.js';
import { editBikeSheet } from './garage.js';
import { routeThumb } from '../map.js';
import { onlineRiders } from '../engine.js';
import { checklistStatus } from './setup.js';
import { heroImage, TYPES, vehicleType } from '../vehicles.js';

export const bikeImage = heroImage;
export function weatherText(w) {
  if (!w) return '';
  const sym = w.symbol || '';
  const word = /thunder/.test(sym) ? 'Storms' : /rain|sleet|drizzle/.test(sym) ? 'Rain' : /fog/.test(sym) ? 'Fog' : /cloud/.test(sym) ? 'Cloudy' : 'Clear';
  return ` · ${Math.round(w.temp)}°${w.rain > 0.2 ? ' · Rain soon' : word === 'Clear' || word === 'Cloudy' ? ' · Good for riding' : ` · ${word}`}`;
}

register('home', (el) => {
  const body = h('div', { class: 'screen-body' });
  el.append(body);
  let lastRide = null;

  const render = () => {
    const u = ctx.user || {};
    const v = u.vehicle || {};
    const ready = checklistStatus();
    const head = h('header', { class: 'home-head' },
      h('div', { class: 'greet' }, h('div', { class: 'body-m variant' }, `${fmtDay()}${weatherText(ctx.weather)}`), h('h1', { class: 'headline-m' }, `Hi, ${(u.name || '').split(' ')[0]}`)),
      iconButton('settings', { label: 'Settings', onclick: () => push('settings') }),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Your profile', onclick: () => push('settings') }, avatar(u.name || '?', { accent: true })));

    const hero = h('section', { class: 'hero', style: `background-image:url("${heroImage(v)}")`, 'aria-label': 'Your bike' },
      h('span', { class: 'tag-glass label-m' }, ic(TYPES[vehicleType(v)].icon), 'My ride'),
      iconButton(v.photo ? 'swap_horiz' : 'add_a_photo', { label: v.photo ? 'Change bike' : 'Add a photo of your bike', style: 'glass', small: true, onclick: editBikeSheet, attrs: { class: 'icon-btn glass small swap' } }),
      h('div', { class: 'info' },
        h('div', {}, h('div', { class: 'title-s make' }, v.make || 'Your bike'), h('div', { class: 'display-s' }, v.model || 'Add your bike')),
        h('div', { class: 'stats' },
          h('div', {}, h('div', { class: 'v' }, h('span', { class: 'title-l' }, v.odometer ? fmtInt(v.odometer) : '–'), h('span', { class: 'title-s l' }, 'km')), h('div', { class: 'label-m l' }, 'Odometer')),
          h('div', {}, h('div', { class: 'v' }, h('span', { class: 'title-l' }, ready.done ? 'Ready' : `${ready.left} to check`)), h('div', { class: 'label-m l' }, 'Last check'))),
        ctx.ride
          ? button('Resume ride', { size: 'large', wide: true, icon: 'navigation', onclick: () => push('ride') })
          : button('Start ride', { size: 'large', wide: true, icon: 'play_arrow', onclick: () => push('setup') })));

    const recent = lastRide
      ? h('button', { type: 'button', class: 'card tappable', style: 'text-align:left;border:0;color:inherit;padding:0', onclick: () => push('summary', { id: lastRide.id }) },
        h('div', { class: 'thumb' }, routeThumb(lastRide.points, { w: 202, hgt: 96 })),
        h('div', { class: 'card-body' }, h('span', { class: 'label-m variant' }, 'Last ride'), h('span', { class: 'title-m' }, lastRide.destination || lastRide.name), h('span', { class: 'body-s variant' }, `${fmtKm(lastRide.distance)} km · ${durShort(lastRide.duration)}`)))
      : h('button', { type: 'button', class: 'card tappable', style: 'text-align:left;border:0;color:inherit;padding:0', onclick: () => push('setup') },
        h('div', { class: 'thumb' }, routeThumb(null, { w: 202, hgt: 96 })),
        h('div', { class: 'card-body' }, h('span', { class: 'label-m variant' }, 'Last ride'), h('span', { class: 'title-m' }, 'No rides yet'), h('span', { class: 'body-s variant' }, 'Your first one shows here')));

    const g = ctx.group;
    const riding = g ? onlineRiders().length : 0;
    const groupCard = g
      ? h('button', { type: 'button', class: 'card tappable', style: 'text-align:left;border:0;color:inherit', onclick: () => push('group', { id: g.id }) },
        h('div', { class: 'card-body', style: 'padding:16px' },
          avatarStack(g.members.map((m) => m.name), 3),
          h('div', { style: 'margin-top:28px' }, h('div', { class: 'title-m' }, g.name), h('div', { class: 'body-s variant' }, riding > 1 ? `${riding - 1} riding nearby` : `${g.members.length} ${g.members.length === 1 ? 'rider' : 'riders'}`)),
          h('div', { class: 'live label-m' }, h('span', { class: `live-dot${riding > 1 ? ' pulse' : ''}`, style: riding > 1 ? '' : 'background:var(--outline)' }), riding > 1 ? 'Live' : 'Quiet')))
      : h('button', { type: 'button', class: 'card tappable', style: 'text-align:left;border:0;color:inherit', onclick: () => tab('groups') },
        h('div', { class: 'card-body', style: 'padding:16px' }, ic('group_add', { size: 32 }),
          h('div', { style: 'margin-top:auto' }, h('div', { class: 'title-m' }, 'Ride with friends'), h('div', { class: 'body-s variant' }, 'Create or join a group'))));

    body.replaceChildren(head, h('div', { style: 'padding:0 16px 24px' },
      hero,
      h('div', { class: 'bento' }, recent, groupCard),
      h('button', { type: 'button', class: 'shortcut', onclick: () => push('setup') }, ic('explore'),
        h('span', { class: 'main' }, h('span', { class: 'title-s' }, 'Plan a ride'), h('span', { class: 'body-s variant' }, 'Pick a destination, check your bike, choose a route')), ic('chevron_right'))));
  };

  render();
  api.get('/api/rides').then(async ({ rides }) => {
    if (!rides.length) return;
    const { ride } = await api.get(`/api/rides/${rides[0].id}`);
    lastRide = ride;
    render();
  }).catch(() => {});
  return onMany({ group: render, groups: render, weather: render, ride: render, settings: render, user: render });
});

export { localDate };
