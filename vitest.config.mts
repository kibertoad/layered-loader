// eslint-disable-next-line import/no-unresolved
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    watch: false,
    maxWorkers: 1,
    isolate: false,
    environment: 'node',
    fileParallelism: false,
    reporters: ['verbose'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    coverage: {
      include: ['lib/**/*.ts'],
      exclude: [
        'node_modules/',
        'coverage/',
        'test',
        'lib/memory/NoopCache.ts',
        'lib/types',
        'lib/notifications/GroupNotificationPublisher.ts',
      ],
      reporter: ['lcov', 'text'],
      all: true,
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
})
