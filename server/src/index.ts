import { config } from './config';
import { initSchema } from './db';
import { seed } from './seed';
import { createApp } from './app';

async function main(): Promise<void> {
  await initSchema();
  await seed();
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`API listening on http://localhost:${config.port}`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
