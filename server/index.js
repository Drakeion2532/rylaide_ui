const { createApp } = require('./app');

const PORT = Number(process.env.PORT) || 3000;
const { server, close } = createApp();

server.listen(PORT, () => console.log(`Rylaide running on http://localhost:${PORT}`));

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await close();
    process.exit(0);
  });
}
