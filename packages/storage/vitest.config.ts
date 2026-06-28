import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node environment + fake-indexeddb provides a spec-compliant IndexedDB
    // implementation, so tests exercise the real engine code paths.
    environment: 'node',
    setupFiles: ['fake-indexeddb/auto'],
    include: ['tests/**/*.test.ts'],
  },
});
