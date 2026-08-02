/**
 * Structural types covering exactly the `ioredis` surface this package uses.
 *
 * They exist so that `ioredis` is not needed to compile against `layered-loader` — neither its
 * runtime nor its type declarations. Consumers keep passing real `ioredis` clients; assignability
 * is structural, so nothing changes on their side.
 *
 * `test/ioredisCompat.type-test.ts` asserts that the real `ioredis` types still satisfy everything
 * declared here, and is type-checked in CI. If `ioredis` changes a signature, that check fails with
 * the offending member named — these declarations are never allowed to drift silently.
 */

export type RedisReconnectOnError = (err: Error) => boolean | 1 | 2

/**
 * Connection options forwarded verbatim to the `ioredis` constructor. Only the fields this package
 * reads are declared; the index signature carries the rest of `RedisOptions` through untouched.
 */
export type RedisConnectionOptions = {
  reconnectOnError?: RedisReconnectOnError | null
  [option: string]: unknown
}

/**
 * Cluster options forwarded verbatim to the `ioredis` cluster constructor. Same arrangement as
 * {@link RedisConnectionOptions}: only the fields this package reads are declared.
 *
 * The index signature is load-bearing, not decoration. Without it these are "weak types" — every
 * property optional — and TypeScript then refuses object literals that share no properties with
 * them, so `enrichRedisConfig({ host, port })` would not compile.
 */
export type RedisClusterConnectionOptions = {
  dnsLookup?: unknown
  redisOptions?: RedisConnectionOptions
  [option: string]: unknown
}

/** The subset of a `multi()` chain this package builds. */
export interface RedisChainableCommander {
  incr(key: string): RedisChainableCommander
  pexpire(key: string, milliseconds: number): RedisChainableCommander
  exec(): Promise<unknown>
}

/** The subset of an `ioredis` client this package calls. */
export interface RedisLike {
  status: string

  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<unknown>
  set(key: string, value: string, expiryMode: 'PX', ttlInMsecs: number): Promise<unknown>
  mget(keys: string[]): Promise<(string | null)[]>
  mset(keyValuePairs: unknown[]): Promise<unknown>
  del(key: string): Promise<number>
  del(keys: string[]): Promise<number>
  incr(key: string): Promise<number>
  pttl(key: string): Promise<number>
  pexpire(key: string, milliseconds: number): Promise<number>
  scan(cursor: string | number, matchToken: 'MATCH', pattern: string): Promise<[string, string[]]>
  multi(commands?: unknown[][]): RedisChainableCommander

  publish(channel: string, message: string): Promise<number>
  subscribe(channel: string): Promise<unknown>
  unsubscribe(channel: string): Promise<unknown>
  quit(callback: (err: Error | null | undefined, result?: 'OK') => void): void

  on(event: 'message', listener: (channel: string, message: string) => void): unknown
  removeListener(event: 'message', listener: (channel: string, message: string) => void): unknown

  defineCommand(name: string, definition: { lua: string; numberOfKeys?: number }): void
}

/** How the `ioredis` module is reached by the lazy loader in `resolveRedisClient`. */
export type RedisConstructorLike = new (options: RedisConnectionOptions) => RedisLike

/**
 * `RedisGroupCache` registers two Lua scripts via `defineCommand`, which adds methods that no
 * static type can know about — not even `ioredis`' own, which is why these call sites previously
 * needed `@ts-ignore`.
 */
export type RedisWithGroupCommands = RedisLike & {
  getOrSetZeroWithTtl(groupIndexKey: string, ttlInMsecs: number): Promise<GroupIndexKey>
  getOrSetZeroWithoutTtl(groupIndexKey: string): Promise<GroupIndexKey>
}

/**
 * Both scripts return the numeric literal `0` when they create the group index, and the stored
 * counter — a string, as everything read back out of Redis is — on every later call.
 */
export type GroupIndexKey = string | number
