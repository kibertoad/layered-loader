import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    watch: false,
    threads: false,
    environment: 'node',
    reporters: ['verbose'],
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
      lines: 100,
      functions: 100,
      branches: 100,
      statements: 100,
    },
  },
})
