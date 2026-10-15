// Vehicle catalogue: what riders in India actually ride, with a body type for each model.
// The type picks the Home hero picture when the owner hasn't added their own photo.

export const TYPES = {
  classic:      { label: 'Classic',        icon: 'two_wheeler', img: '/img/bike-classic.jpg' },
  roadster:     { label: 'Roadster',       icon: 'two_wheeler', img: '/img/bike-roadster.jpg' },
  cruiser:      { label: 'Cruiser',        icon: 'two_wheeler', img: '/img/bike-cruiser.jpg' },
  adventure:    { label: 'Adventure',      icon: 'two_wheeler', img: '/img/bike-adventure.jpg' },
  sport:        { label: 'Sport',          icon: 'sports_motorsports', img: '/img/bike-sport.jpg' },
  commuter:     { label: 'Commuter',       icon: 'two_wheeler', img: '/img/bike-roadster.jpg' },
  scooter:      { label: 'Scooter',        icon: 'moped', art: 'scooter' },
  'ev-scooter': { label: 'Electric scooter', icon: 'electric_moped', art: 'scooter', electric: true },
  bicycle:      { label: 'Bicycle',        icon: 'pedal_bike', art: 'bicycle' },
  'e-bike':     { label: 'E-bike',         icon: 'electric_bike', art: 'bicycle', electric: true },
};

/** [make, model, type] */
const RAW = [
  // Royal Enfield
  ['Royal Enfield', 'Classic 350', 'classic'], ['Royal Enfield', 'Bullet 350', 'classic'], ['Royal Enfield', 'Hunter 350', 'roadster'],
  ['Royal Enfield', 'Meteor 350', 'cruiser'], ['Royal Enfield', 'Super Meteor 650', 'cruiser'], ['Royal Enfield', 'Shotgun 650', 'cruiser'],
  ['Royal Enfield', 'Interceptor 650', 'roadster'], ['Royal Enfield', 'Continental GT 650', 'sport'], ['Royal Enfield', 'Himalayan 450', 'adventure'],
  ['Royal Enfield', 'Himalayan', 'adventure'], ['Royal Enfield', 'Scram 411', 'adventure'], ['Royal Enfield', 'Guerrilla 450', 'roadster'],
  ['Royal Enfield', 'Classic 650', 'classic'], ['Royal Enfield', 'Bear 650', 'adventure'], ['Royal Enfield', 'Goan Classic 350', 'cruiser'],
  // Jawa · Yezdi · BSA
  ['Jawa', '42', 'classic'], ['Jawa', '350', 'classic'], ['Jawa', 'Perak', 'cruiser'], ['Yezdi', 'Roadster', 'roadster'],
  ['Yezdi', 'Adventure', 'adventure'], ['Yezdi', 'Scrambler', 'adventure'], ['BSA', 'Gold Star 650', 'classic'],
  // Honda
  ['Honda', 'Shine 125', 'commuter'], ['Honda', 'SP 125', 'commuter'], ['Honda', 'Unicorn', 'commuter'], ['Honda', 'CB Hornet 2.0', 'roadster'],
  ['Honda', 'H’ness CB350', 'classic'], ['Honda', 'CB350RS', 'roadster'], ['Honda', 'CB300F', 'roadster'], ['Honda', 'CB200X', 'adventure'],
  ['Honda', 'NX500', 'adventure'], ['Honda', 'CBR650R', 'sport'], ['Honda', 'Activa', 'scooter'], ['Honda', 'Activa 125', 'scooter'],
  ['Honda', 'Dio', 'scooter'], ['Honda', 'Activa e', 'ev-scooter'],
  // Hero
  ['Hero', 'Splendor Plus', 'commuter'], ['Hero', 'HF Deluxe', 'commuter'], ['Hero', 'Passion Pro', 'commuter'], ['Hero', 'Glamour', 'commuter'],
  ['Hero', 'Super Splendor', 'commuter'], ['Hero', 'Xtreme 160R', 'roadster'], ['Hero', 'Xtreme 125R', 'roadster'], ['Hero', 'Xpulse 200 4V', 'adventure'],
  ['Hero', 'Xpulse 210', 'adventure'], ['Hero', 'Mavrick 440', 'roadster'], ['Hero', 'Karizma XMR', 'sport'], ['Hero', 'Pleasure+', 'scooter'],
  ['Hero', 'Destini 125', 'scooter'], ['Hero', 'Xoom', 'scooter'], ['Harley-Davidson', 'X440', 'roadster'],
  ['Hero', 'Vida V1', 'ev-scooter'], ['Hero', 'Vida V2', 'ev-scooter'],
  // Bajaj · KTM · Triumph (made by Bajaj)
  ['Bajaj', 'Pulsar 150', 'commuter'], ['Bajaj', 'Pulsar N160', 'roadster'], ['Bajaj', 'Pulsar NS200', 'roadster'], ['Bajaj', 'Pulsar N250', 'roadster'],
  ['Bajaj', 'Pulsar RS200', 'sport'], ['Bajaj', 'Pulsar NS400Z', 'roadster'], ['Bajaj', 'Dominar 400', 'roadster'], ['Bajaj', 'Dominar 250', 'roadster'],
  ['Bajaj', 'Avenger 220 Cruise', 'cruiser'], ['Bajaj', 'Avenger 160 Street', 'cruiser'], ['Bajaj', 'Platina', 'commuter'], ['Bajaj', 'CT 110', 'commuter'],
  ['Bajaj', 'Freedom 125', 'commuter'], ['Bajaj', 'Chetak', 'ev-scooter'],
  ['KTM', '200 Duke', 'roadster'], ['KTM', '250 Duke', 'roadster'], ['KTM', '390 Duke', 'roadster'], ['KTM', 'RC 200', 'sport'], ['KTM', 'RC 390', 'sport'],
  ['KTM', '390 Adventure', 'adventure'], ['KTM', '250 Adventure', 'adventure'], ['KTM', '890 Adventure', 'adventure'],
  ['Triumph', 'Speed 400', 'roadster'], ['Triumph', 'Scrambler 400 X', 'adventure'], ['Triumph', 'Speed Twin 900', 'classic'],
  ['Triumph', 'Tiger 900', 'adventure'], ['Triumph', 'Street Triple', 'roadster'], ['Triumph', 'Trident 660', 'roadster'],
  // TVS
  ['TVS', 'Apache RTR 160 4V', 'roadster'], ['TVS', 'Apache RTR 200 4V', 'roadster'], ['TVS', 'Apache RR 310', 'sport'], ['TVS', 'Apache RTR 310', 'roadster'],
  ['TVS', 'Raider 125', 'commuter'], ['TVS', 'Radeon', 'commuter'], ['TVS', 'Star City+', 'commuter'], ['TVS', 'Ronin', 'roadster'],
  ['TVS', 'Jupiter', 'scooter'], ['TVS', 'Ntorq 125', 'scooter'], ['TVS', 'iQube', 'ev-scooter'],
  // Yamaha · Suzuki · Kawasaki
  ['Yamaha', 'R15 V4', 'sport'], ['Yamaha', 'R15S', 'sport'], ['Yamaha', 'R3', 'sport'], ['Yamaha', 'MT-15', 'roadster'], ['Yamaha', 'MT-03', 'roadster'],
  ['Yamaha', 'FZ-S', 'commuter'], ['Yamaha', 'FZ-X', 'roadster'], ['Yamaha', 'Fascino 125', 'scooter'], ['Yamaha', 'RayZR 125', 'scooter'], ['Yamaha', 'Aerox 155', 'scooter'],
  ['Suzuki', 'Gixxer', 'roadster'], ['Suzuki', 'Gixxer SF 250', 'sport'], ['Suzuki', 'V-Strom SX', 'adventure'], ['Suzuki', 'V-Strom 800DE', 'adventure'],
  ['Suzuki', 'Hayabusa', 'sport'], ['Suzuki', 'Access 125', 'scooter'], ['Suzuki', 'Burgman Street', 'scooter'], ['Suzuki', 'Avenis', 'scooter'],
  ['Kawasaki', 'Ninja 300', 'sport'], ['Kawasaki', 'Ninja 500', 'sport'], ['Kawasaki', 'Ninja ZX-10R', 'sport'], ['Kawasaki', 'Z900', 'roadster'],
  ['Kawasaki', 'Versys 650', 'adventure'], ['Kawasaki', 'Vulcan S', 'cruiser'], ['Kawasaki', 'W175', 'classic'],
  // Premium
  ['BMW', 'G 310 GS', 'adventure'], ['BMW', 'G 310 R', 'roadster'], ['BMW', 'R 1300 GS', 'adventure'], ['BMW', 'S 1000 RR', 'sport'],
  ['Harley-Davidson', 'Nightster', 'cruiser'], ['Harley-Davidson', 'Fat Boy', 'cruiser'], ['Harley-Davidson', 'Pan America', 'adventure'],
  ['Ducati', 'Scrambler', 'roadster'], ['Ducati', 'Monster', 'roadster'], ['Ducati', 'Panigale V2', 'sport'], ['Ducati', 'Multistrada V4', 'adventure'],
  ['Benelli', 'Imperiale 400', 'classic'], ['Benelli', 'TRK 502', 'adventure'], ['Aprilia', 'RS 457', 'sport'], ['Aprilia', 'SR 160', 'scooter'],
  ['Husqvarna', 'Svartpilen 401', 'roadster'], ['Husqvarna', 'Vitpilen 250', 'roadster'], ['Keeway', 'K-Light 250V', 'cruiser'],
  // Electric
  ['Ather', '450X', 'ev-scooter'], ['Ather', '450 Apex', 'ev-scooter'], ['Ather', 'Rizta', 'ev-scooter'], ['Ola', 'S1 Pro', 'ev-scooter'],
  ['Ola', 'S1 Air', 'ev-scooter'], ['Ola', 'S1 X', 'ev-scooter'], ['Ola', 'Roadster X', 'roadster'], ['Revolt', 'RV400', 'roadster'],
  ['Ultraviolette', 'F77', 'sport'], ['Simple', 'One', 'ev-scooter'], ['River', 'Indie', 'ev-scooter'], ['Okinawa', 'PraisePro', 'ev-scooter'],
  ['Ampere', 'Nexus', 'ev-scooter'],
  // Bicycles + e-bikes
  ['Hero Cycles', 'Sprint', 'bicycle'], ['Hero Cycles', 'Octane', 'bicycle'], ['Firefox', 'Road Runner', 'bicycle'], ['Firefox', 'Bad Attitude', 'bicycle'],
  ['Btwin', 'Rockrider ST 100', 'bicycle'], ['Btwin', 'Rockrider ST 530', 'bicycle'], ['Btwin', 'Triban RC 100', 'bicycle'], ['Btwin', 'Riverside 120', 'bicycle'],
  ['Montra', 'Rock', 'bicycle'], ['Montra', 'Helicon', 'bicycle'], ['Hercules', 'Roadeo', 'bicycle'], ['Trek', 'Marlin 5', 'bicycle'],
  ['Trek', 'FX 2', 'bicycle'], ['Giant', 'Talon', 'bicycle'], ['Giant', 'Escape', 'bicycle'], ['Specialized', 'Rockhopper', 'bicycle'],
  ['Cannondale', 'Trail', 'bicycle'], ['Polygon', 'Siskiu', 'bicycle'], ['Scott', 'Aspect', 'bicycle'],
  ['EMotorad', 'X1', 'e-bike'], ['EMotorad', 'T-Rex', 'e-bike'], ['Hero Lectro', 'C5', 'e-bike'], ['Hero Lectro', 'H5', 'e-bike'], ['Btwin', 'Rockrider E-ST 100', 'e-bike'],
];
export const CATALOG = RAW.map(([make, model, type]) => ({ make, model, type }));
export const MAKES = [...new Set(RAW.map((r) => r[0]))].sort();
export const modelsFor = (make) => CATALOG.filter((v) => v.make.toLowerCase() === String(make || '').trim().toLowerCase()).map((v) => v.model);

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Best guess of the body type from make + model, using the catalogue then keywords. */
export function inferType(make, model) {
  const m = norm(make), md = norm(model);
  if (!m && !md) return null;
  const exact = CATALOG.find((v) => norm(v.make) === m && norm(v.model) === md);
  if (exact) return exact.type;
  const partial = md && CATALOG.find((v) => (!m || norm(v.make) === m) && (norm(v.model).includes(md) || md.includes(norm(v.model))));
  if (partial) return partial.type;
  const t = `${make} ${model}`.toLowerCase();
  if (/e-?bike|lectro|emotorad|e-?cycle/.test(t)) return 'e-bike';
  if (/cycle|rockrider|triban|mtb|bicycle|firefox|montra|hercules|trek|giant|btwin/.test(t)) return 'bicycle';
  if (/ather|ola|iqube|chetak|vida|simple one|ev\b|electric/.test(t)) return 'ev-scooter';
  if (/activa|jupiter|access|ntorq|dio|fascino|burgman|scooty|pleasure|destini|scooter|maestro|aerox/.test(t)) return 'scooter';
  if (/adv|gs\b|himalayan|xpulse|tiger|strom|versys|scram|trk|africa|tenere/.test(t)) return 'adventure';
  if (/cruise|avenger|meteor|vulcan|harley|rebel|bobber/.test(t)) return 'cruiser';
  if (/\br\s?15|rc\b|rr\b|ninja|cbr|panigale|gixxer sf|rs\s?\d|karizma|hayabusa/.test(t)) return 'sport';
  if (/classic|bullet|jawa|cb350|imperiale|standard/.test(t)) return 'classic';
  if (/splendor|shine|platina|passion|hf|raider|radeon|glamour|fz|unicorn|pulsar 1[25]0|ct\b/.test(t)) return 'commuter';
  if (m) return 'roadster';
  return null;
}

export const vehicleType = (v) => (v?.type && TYPES[v.type] ? v.type : inferType(v?.make, v?.model) || 'classic');

/** Picture for the Home hero: the owner's own photo first, then the type's photo or illustration. */
export function heroImage(v) {
  if (v?.photo) return `/photos/${v.photo}.jpg`;
  const t = TYPES[vehicleType(v)];
  return t.img || artDataUrl(t.art, t.electric);
}

/** Clean side-view illustrations for types without a library photo (scooters, bicycles), on the app's asphalt gradient. */
export function artDataUrl(kind, electric) {
  const bg = `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3A434D"/><stop offset="1" stop-color="#14191F"/></linearGradient>
    <radialGradient id="glow" cx=".5" cy=".62" r=".5"><stop offset="0" stop-color="#ffffff" stop-opacity=".18"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient></defs>
    <rect width="900" height="1200" fill="url(#g)"/><ellipse cx="450" cy="760" rx="420" ry="300" fill="url(#glow)"/>
    <rect y="900" width="900" height="300" fill="#0E1216" opacity=".55"/><ellipse cx="450" cy="905" rx="360" ry="16" fill="#000" opacity=".45"/>`;
  const stroke = 'stroke="#E9EDF1" stroke-linecap="round" stroke-linejoin="round" fill="none"';
  const accent = electric ? '#2FC9C3' : '#F98924';
  const bolt = electric ? `<path d="M455 560 l-28 52 h26 l-14 46 46-64 h-26 l18-34z" fill="${accent}"/>` : '';
  let art = '';
  if (kind === 'bicycle') {
    art = `<g ${stroke} stroke-width="16"><circle cx="250" cy="760" r="130"/><circle cx="650" cy="760" r="130"/></g>
      <g ${stroke} stroke-width="5" opacity=".45"><circle cx="250" cy="760" r="110"/><circle cx="650" cy="760" r="110"/></g>
      <g stroke="${accent}" stroke-width="20" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M250 760 L380 560 L600 560 L650 760 M380 560 L455 770 L600 560 M455 770 L250 760"/><path d="M590 520 L650 760"/></g>
      <g ${stroke} stroke-width="18"><path d="M330 520 h90"/><path d="M560 500 q40-10 70 10"/></g><circle cx="455" cy="770" r="26" fill="#E9EDF1"/>${bolt}`;
  } else {
    art = `<g ${stroke} stroke-width="22"><circle cx="250" cy="790" r="96"/><circle cx="660" cy="790" r="96"/></g>
      <circle cx="250" cy="790" r="34" fill="#E9EDF1"/><circle cx="660" cy="790" r="34" fill="#E9EDF1"/>
      <path d="M160 760 Q170 640 300 630 L470 630 Q520 630 540 700 L560 760 Z" fill="${accent}"/>
      <path d="M300 600 h170 q30 0 30 24 v6 h-230 v-6 q0-24 30-24z" fill="#E9EDF1"/>
      <path d="M560 760 L610 520 Q615 470 660 460 L700 455" stroke="${accent}" stroke-width="30" stroke-linecap="round" fill="none"/>
      <path d="M680 440 h70" stroke="#E9EDF1" stroke-width="20" stroke-linecap="round"/><circle cx="726" cy="520" r="20" fill="#FFE7A6"/>
      <path d="M560 760 Q600 700 660 694 Q720 700 756 760" stroke="${accent}" stroke-width="22" fill="none" stroke-linecap="round"/>${bolt}`;
  }
  return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 1200" preserveAspectRatio="xMidYMid slice">${bg}${art}</svg>`)}`;
}

/** Resize a picked image on the phone to a JPEG (max 1400 px), returned as base64 for upload. */
export async function photoToJpeg(file, max = 1400) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('That file isn’t a photo we can read.')); i.src = url; });
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    let q = 0.86, data = c.toDataURL('image/jpeg', q);
    while (data.length > 2_400_000 && q > 0.5) { q -= 0.1; data = c.toDataURL('image/jpeg', q); }
    return data.split(',')[1];
  } finally { URL.revokeObjectURL(url); }
}
