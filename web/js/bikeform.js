// Shared bike form: make/model with suggestions from the catalogue, type auto-detected, odometer, owner photo.
import { h } from './util.js';
import { ic, field, button, snackbar } from './ui.js';
import { MAKES, modelsFor, inferType, TYPES, heroImage, photoToJpeg } from './vehicles.js';

let uid = 0;
export function bikeForm({ vehicle = {}, onSurface = false } = {}) {
  const n = ++uid;
  const makeList = h('datalist', { id: `makes-${n}` }, MAKES.map((m) => h('option', { value: m })));
  const modelList = h('datalist', { id: `models-${n}` });
  const make = field({ label: 'Make', value: vehicle.make || '', attrs: { maxlength: 30, list: `makes-${n}`, autocomplete: 'off', name: 'make' }, onSurface, support: 'Royal Enfield, Honda, Ather, Btwin…' });
  const model = field({ label: 'Model', value: vehicle.model || '', attrs: { maxlength: 40, list: `models-${n}`, autocomplete: 'off', name: 'model' }, onSurface });
  const odo = field({ label: 'Odometer (km)', type: 'number', value: vehicle.odometer ?? '', attrs: { inputmode: 'numeric', min: 0, name: 'odometer' }, onSurface, support: 'Optional. Used by your fuel log.' });
  let typeTouched = !!vehicle.type;
  let type = vehicle.type || inferType(vehicle.make, vehicle.model) || '';
  const typeSel = h('select', { 'aria-label': 'Type', name: 'type' }, h('option', { value: '' }, 'Choose…'), Object.entries(TYPES).map(([k, t]) => h('option', { value: k, selected: k === type }, t.label)));
  const typeField = h('label', { class: `field${onSurface ? ' on-surface' : ''}` }, typeSel, h('label', {}, 'Type'));
  let photoB64 = null, removePhoto = false;
  const preview = h('div', { class: 'bike-preview', role: 'img', 'aria-label': 'How your bike shows on Home' });
  const fileIn = h('input', { type: 'file', accept: 'image/*', hidden: true });
  const photoBtn = button(vehicle.photo ? 'Change photo' : 'Add a photo of your bike', { style: 'tonal', icon: 'photo_camera', onclick: () => fileIn.click() });
  const removeBtn = button('Use the default picture', { style: 'text', onclick: () => { photoB64 = null; removePhoto = true; removeBtn.hidden = true; photoBtn.lastChild.textContent = 'Add a photo of your bike'; refresh(); } });
  removeBtn.hidden = !vehicle.photo;
  const hint = h('p', { class: 'body-s variant' });

  const refresh = () => {
    const v = { type: type || null, make: make.input.value, model: model.input.value, photo: removePhoto ? null : vehicle.photo };
    preview.style.backgroundImage = `url("${photoB64 ? `data:image/jpeg;base64,${photoB64}` : heroImage(v)}")`;
    preview.classList.toggle('own', !!(photoB64 || v.photo));
    hint.textContent = photoB64 || v.photo ? 'Your photo shows on Home.' : `Showing a ${TYPES[type]?.label.toLowerCase() || 'bike'} picture until you add your own photo.`;
  };
  const onMakeModel = () => {
    modelList.replaceChildren(...modelsFor(make.input.value).map((m) => h('option', { value: m })));
    if (!typeTouched) { type = inferType(make.input.value, model.input.value) || ''; typeSel.value = type; }
    refresh();
  };
  make.input.addEventListener('input', onMakeModel);
  model.input.addEventListener('input', onMakeModel);
  typeSel.addEventListener('change', () => { type = typeSel.value; typeTouched = true; refresh(); });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files?.[0];
    if (!f) return;
    try { photoB64 = await photoToJpeg(f); removePhoto = false; removeBtn.hidden = false; photoBtn.lastChild.textContent = 'Change photo'; refresh(); } catch (e) { snackbar(e.message); }
    fileIn.value = '';
  });
  onMakeModel();

  const el = h('div', { class: 'stack gap16' }, makeList, modelList, preview, h('div', { class: 'row gap8', style: 'flex-wrap:wrap' }, photoBtn, removeBtn), hint, fileIn,
    make, model, typeField, odo);
  return {
    el,
    value: () => ({ type: type || null, make: make.input.value, model: model.input.value, odometer: odo.input.value }),
    photo: () => photoB64,
    removePhoto: () => removePhoto,
    setError: (msg) => odo.setError(msg),
  };
}

/** Save vehicle + photo for the signed-in user; returns the updated user. */
export async function saveBike(api, form) {
  let { user } = await api.patch('/api/me', { vehicle: form.value() });
  if (form.photo()) ({ user } = await api.post('/api/me/photo', { data: form.photo() }));
  else if (form.removePhoto()) ({ user } = await api.del('/api/me/photo'));
  return user;
}
