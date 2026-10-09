import { createApp } from './app.js';

const port = Number(process.env.PORT) || 3000;
const dbPath = process.env.DB_PATH || './data/ajaia.db';
const { server } = createApp({ dbPath, seedData: process.env.SEED !== '0' });
server.listen(port, '0.0.0.0', () => console.log(`Ajaia Docs running on http://localhost:${port}`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
