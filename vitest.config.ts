import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // Test discovery
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'web'],

    // Environment
    environment: 'node',
    globals: true,

    // TypeScript configuration
    typecheck: {
      tsconfig: './tsconfig.test.json',
    },

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json', 'lcov'],

      // Only include the three service files
      include: [
        'src/lib/validation-service.ts',
        'src/lib/model-management-service.ts',
        'src/lib/server-config-service.ts',
      ],

      // Exclude test files and other sources
      exclude: [
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/node_modules/**',
        '**/dist/**',
        '**/tests/**',
      ],

      // Coverage thresholds per service
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,

        // Specific thresholds per file
        'src/lib/validation-service.ts': {
          lines: 95,
          functions: 95,
          branches: 95,
          statements: 95,
        },
        'src/lib/model-management-service.ts': {
          lines: 85,
          functions: 85,
          branches: 85,
          statements: 85,
        },
        'src/lib/server-config-service.ts': {
          lines: 80,
          functions: 80,
          branches: 80,
          statements: 80,
        },
      },
    },

    // Mock configuration
    clearMocks: true,
    restoreMocks: true,
    resetMocks: true,

    // Setup file
    setupFiles: ['./tests/setup.ts'],

    // Timeout configuration
    testTimeout: 10000,
    hookTimeout: 10000,

    // Suppress console output in tests (can be enabled for debugging)
    silent: false,

    // Reporter configuration
    reporter: 'verbose',

    // Force all imports to be treated as ES modules
    deps: {
      interopDefault: true,
    },
  },

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@tests': path.resolve(__dirname, './tests'),
    },
  },

  server: {
    deps: {
      inline: ['vitest'],
    },
  },

  esbuild: {
    target: 'esnext',
  },
});
