// Fake OSRM / Nominatim / MET Norway so tests run without internet access.
const http = require('http');

function startMockUpstream() {
  const calls = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    calls.push({ path: url.pathname, ua: req.headers['user-agent'] });
    res.setHeader('content-type', 'application/json');
    if (url.pathname.startsWith('/route/v1/driving/')) {
      const [a, b] = url.pathname.split('/').pop().split(';').map((p) => p.split(',').map(Number));
      if (a[0] === 0 && a[1] === 0) return res.end(JSON.stringify({ code: 'NoRoute', routes: [] }));
      const alt = (distance, duration, bend) => ({
        distance, duration,
        geometry: { type: 'LineString', coordinates: [a, [(a[0] + b[0]) / 2 + bend, (a[1] + b[1]) / 2 + bend], b] },
        legs: [{ steps: [
          { distance: 300, duration: 40, name: 'Station Rd', maneuver: { type: 'depart', bearing_after: 0, location: a } },
          { distance: 0, duration: 0, name: '', maneuver: { type: 'arrive', location: b } },
        ] }],
      });
      const extra = url.searchParams.get('alternatives') ? [alt(13100, 1300, 0.01), alt(15800, 2100, -0.02)] : [];
      return res.end(JSON.stringify({
        code: 'Ok',
        routes: [{
          distance: 12345.6, duration: 1500.2,
          geometry: { type: 'LineString', coordinates: [a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], b] },
          legs: [{ steps: [
            { distance: 400, duration: 60, name: 'FC Road', maneuver: { type: 'depart', bearing_after: 90, location: a } },
            { distance: 6000, duration: 700, name: 'Ganeshkhind Road', maneuver: { type: 'turn', modifier: 'left', location: a } },
            { distance: 5000, duration: 600, name: '', maneuver: { type: 'roundabout', exit: 2, location: b } },
            { distance: 0, duration: 0, name: '', maneuver: { type: 'arrive', location: b } },
          ] }],
        }, ...extra],
      }));
    }
    if (url.pathname === '/search') {
      const q = url.searchParams.get('q') || '';
      if (q === 'nowhere') return res.end('[]');
      return res.end(JSON.stringify([
        { display_name: `${q}, Pune, Maharashtra, India`, lat: '18.5204', lon: '73.8567' },
        { display_name: `${q} Fort, Maharashtra, India`, lat: '18.3663', lon: '73.7559' },
      ]));
    }
    if (url.pathname === '/weather') {
      return res.end(JSON.stringify({ properties: { timeseries: [{ data: {
        instant: { details: { air_temperature: 27.4, wind_speed: 3.1 } },
        next_1_hours: { summary: { symbol_code: 'partlycloudy_day' }, details: { precipitation_amount: 0 } },
      } }] } }));
    }
    res.statusCode = 500;
    res.end('{}');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    resolve({ base, calls, close: () => new Promise((r) => server.close(r)) });
  }));
}

module.exports = { startMockUpstream };
