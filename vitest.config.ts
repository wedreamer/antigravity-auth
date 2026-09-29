import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const piAiStub = resolve(here, 'packages/pi-extension/test-support/pi-ai-stub.ts');

export default defineConfig({
  resolve: {
    alias: {
      '@earendil-works/pi-ai/compat': piAiStub,
      '@earendil-works/pi-ai': piAiStub,
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'packages/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    // The OAuth login tests bind the fixed redirect port 51121 the real flow uses, so their files
    // must not run concurrently: a second listener gets EADDRINUSE and the callback never lands,
    // which showed up as a flaky failure in the full suite.
    sequence: {
      concurrent: false,
    },
    fileParallelism: false,
  },
});
