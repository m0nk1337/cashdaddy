import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    env: {
      AUTH_RATE_LIMIT: '5000',
      MAX_ACCOUNTS_PER_IP: '5000',
      EMAIL_MODE: 'log',
    },
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
