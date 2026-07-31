import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom', // provides localStorage, crypto, basic DOM
    globals: true,
  },
});
