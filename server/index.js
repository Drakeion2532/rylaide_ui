const { createApp } = require('./app');

const PORT = Number(process.env.PORT) || 3000;
const { server, close, ready, cfg } = createApp();

ready.then(() => {
  server.listen(PORT, () => console.log(`Rylaide running on http://localhost:${PORT} · data in ${cfg.databaseUrl ? 'the database' : cfg.dataFile}`));
}).catch((e) => {
  // Don't serve with empty data: the next save would overwrite what's in the database.
  console.error(`Couldn’t load data from the database: ${e.message}\nCheck DATABASE_URL. Exiting so the host restarts the server.`);
  process.exit(1);
});

// Render's free plan sleeps after 15 minutes without traffic and takes about a minute to wake.
// Pinging our own public address every 10 minutes keeps it awake (uses about 744 of the 750 free hours a month).
const self = process.env.KEEP_AWAKE_URL || process.env.RENDER_EXTERNAL_URL;
if (self && process.env.KEEP_AWAKE !== 'off') {
  setInterval(() => fetch(`${self}/healthz`).catch(() => {}), 10 * 60 * 1000).unref();
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await close();
    process.exit(0);
  });
}
