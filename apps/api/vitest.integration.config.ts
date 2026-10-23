import { defineConfig } from 'vitest/config';

// Kept separate so ordinary unit tests never open database connections.
export default defineConfig({
  test: {
    include: ['integration/**/*.integration.ts'],
    fileParallelism: false,
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
});
