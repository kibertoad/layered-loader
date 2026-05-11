/** Shared utilities for the @layered-loader/sqs test suite. */

/** Stub flat async cache that returns a fixed value for any key. */
export class StubAsyncCache {
  public name = 'StubAsyncCache'
  constructor(private readonly value: string) {}
  get() {
    return Promise.resolve(this.value)
  }
  getMany(keys: string[]) {
    return Promise.resolve({ resolvedValues: keys.map(() => this.value), unresolvedKeys: [] })
  }
  set(): Promise<void> {
    return Promise.resolve()
  }
  delete(): Promise<void> {
    return Promise.resolve()
  }
  deleteMany(): Promise<void> {
    return Promise.resolve()
  }
  clear(): Promise<void> {
    return Promise.resolve()
  }
  close(): Promise<void> {
    return Promise.resolve()
  }
  getExpirationTime() {
    return Promise.resolve(undefined)
  }
}

/** Stub group async cache that returns a fixed value for any (key, group). */
export class StubGroupedAsyncCache {
  public name = 'StubGroupedAsyncCache'
  constructor(private readonly value: string) {}
  getFromGroup() {
    return Promise.resolve(this.value)
  }
  getManyFromGroup(keys: string[]) {
    return Promise.resolve({ resolvedValues: keys.map(() => this.value), unresolvedKeys: [] })
  }
  setForGroup(): Promise<void> {
    return Promise.resolve()
  }
  deleteFromGroup(): Promise<void> {
    return Promise.resolve()
  }
  deleteGroup(): Promise<void> {
    return Promise.resolve()
  }
  clear(): Promise<void> {
    return Promise.resolve()
  }
  close(): Promise<void> {
    return Promise.resolve()
  }
  getExpirationTimeFromGroup() {
    return Promise.resolve(undefined)
  }
}

/**
 * Polls `predicate` every `intervalMs` until it returns truthy or the timeout
 * is reached. Throws on timeout. Use for assertions about events that happen
 * asynchronously after a publish.
 */
export async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5000,
  intervalMs = 50,
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error('Timed out waiting for predicate')
}

/** Random short suffix for unique resource names within a single test. */
export function uniqueSuffix(): string {
  return Math.random().toString(36).slice(2, 8)
}
