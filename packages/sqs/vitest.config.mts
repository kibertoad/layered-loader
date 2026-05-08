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
    testTimeout: 30000,
    hookTimeout: 30000,
    globalSetup: ['./test/globalSetup.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    coverage: {
      include: ['lib/**/*.ts', 'index.ts'],
      reporter: ['lcov', 'text'],
      all: true,
    },
  },
})
