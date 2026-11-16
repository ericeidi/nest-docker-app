import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Subir o container do Postgres (Testcontainers) leva mais que o padrão de 10s
    hookTimeout: 60000,
  },
});
