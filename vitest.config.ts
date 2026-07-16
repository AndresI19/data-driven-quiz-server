import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// The client is not testable without a DOM: runtime/data.ts resolves `#app` at module load, and the
// mode renderers write straight into it. happy-dom gives us that, and `setup.ts` plants the element
// before any module under test is imported — otherwise `app` would be null for the whole run.
export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: [resolve(__dirname, 'test/setup.ts')],
    include: ['test/**/*.test.ts'],
  },
});
