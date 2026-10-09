import { defineConfig } from 'vitest/config';

// Audit-only reproductions; deliberately outside the project's default suite.
export default defineConfig({
  test: { include: ['docs/audits/2026-10-08/reproduce.test.ts'] },
});
