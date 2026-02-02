import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'miniflare',
    environmentOptions: {
      kvNamespaces: ['TENANT_KV', 'TENANT_TOKENS', 'SECRETS_KV'],
      r2Buckets: ['PLUGIN_CACHE', 'TENANT_STORAGE'],
    },
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
    },
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
