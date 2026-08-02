# Changelog

## 16.0.0

### Breaking

- **`ioredis` moved from `dependencies` to an optional `peerDependency`.** It is no longer installed
  for you. Anyone using Redis must declare `ioredis` in their own `package.json`:

  ```jsonc
  "dependencies": {
    "ioredis": "^6.0.0"
  }
  ```

  Most consumers already do — `RedisCache` and `RedisGroupCache` take a client you construct
  yourself, so you have to import `ioredis` to use them at all. The case that changes behaviour is
  calling `createNotificationPair` / `createGroupNotificationPair` with plain connection options
  while never importing `ioredis` yourself: that now throws where the client is constructed, with a
  message telling you to install it.

  See [How optional `ioredis` really is](./README.md#how-optional-ioredis-really-is) for what is
  installed vs. loaded vs. compiled against, when you still need it, and what it means for bundling.

### Added

- Two new subpath entrypoints, so Redis is genuinely optional — not installed, not loaded, and not
  referenced by the types a consumer compiles against:
  - `layered-loader/core` — loaders, manual caches, in-memory caches,
    `AbstractNotificationConsumer`, the publisher interfaces, key resolvers and every type. Nothing
    reachable from it imports `ioredis`, or even a `node:` builtin; its only runtime dependency is
    `toad-cache`. This is the entrypoint for consumers without Redis in their infrastructure, and
    for runtimes that cannot load a Node-only client at all (Cloudflare Workers and friends).
  - `layered-loader/redis` — the Redis caches, notification factories, publishers and consumers.

  The package root remains an `export *` of both, so its surface is unchanged and existing imports
  keep working.
- `InMemoryCache`, `InMemoryGroupCache` and `InMemoryGroupCacheConfiguration` are now exported as
  types. `InMemoryGroupCache` in particular is referenced by `AbstractNotificationConsumer`'s
  generic parameter, and was previously unreachable from the package.
- `sideEffects: false`, so bundlers can drop unused re-exports from the root entrypoint.

### Changed

- `ioredis` is now resolved lazily, on the branch of `createNotificationPair` /
  `createGroupNotificationPair` where a client is constructed from connection options rather than
  passed in. No file in the package imports it statically any more, so every entrypoint imports
  cleanly with `ioredis` absent.
- The types this package uses from `ioredis` are now vendored as structural interfaces in
  `lib/redis/RedisLike.ts`, so no emitted `.d.ts` references `ioredis`. `test/ioredisCompat.type-test.ts`
  type-checks those declarations against the real `ioredis` types in CI, so they cannot drift silently.
- `enrichRedisConfig` and `enrichRedisConfigOptimizedForCloud` are now generic over the caller's own
  options type instead of being typed against `RedisOptions` / `ClusterOptions`. Callers keep their
  exact type through the round trip; the functions no longer need `ioredis` to compile.
- `RedisGroupCache.resolveKeyWithGroup` accepts `string | number` for the group index key, matching
  what the Lua scripts actually return (`0` on creation, the stored counter afterwards). This was
  previously masked by `@ts-ignore`, which is now removed.
- `@layered-loader/sqs` imports from `layered-loader/core`, so the SNS/SQS adapter no longer pulls
  Redis types or code into its consumers' graphs.
- `isClient` no longer throws a `TypeError` when handed `null`, `undefined` or a primitive; such
  values are simply not clients.

## 15.0.0

### Breaking

- The package is now **ESM-only**. `layered-loader` declares `"type": "module"`, ships an `exports`
  map and no longer publishes a CommonJS build, so `require('layered-loader')` from CommonJS code no
  longer resolves to the library on Node versions without `require(esm)` support. Import it from ESM,
  or use a dynamic `await import('layered-loader')` from CommonJS.
- Only `.` and `./package.json` are exported. Deep imports such as
  `layered-loader/dist/lib/redis/RedisCache` no longer resolve; import everything from the package
  root instead.
- `ioredis` was upgraded from 5 to 6. Applications that also depend on `ioredis` directly should
  upgrade with it, and should review the [ioredis 6 migration
  notes](https://github.com/redis/ioredis/releases) for their own usage.
- The published build no longer contains `*.spec.ts` sources or their compiled output.
- The documented minimum Node version is now 22, matching the `engines` field the package has
  declared since 14.x.

## 14.5.0 – 14.5.3

### Added

- Optional `isEntryStillCurrentFn` staleness checker for conditional cache refresh. When a cached
  entry enters the `ttlLeftBeforeRefreshInMsecs` window, the loader can run a lightweight freshness
  check instead of unconditionally refetching, and reset the entry's TTL when it is still current.
  Backed by new optional `resetTtl` / `resetTtlFromGroup` cache methods (implemented by `RedisCache`
  and `RedisGroupCache`). See the README section "Conditional refresh with a staleness check".
- `isEntryStillCurrentFn` now also works on in-memory-only loaders: when no async cache is
  configured, the check runs on the in-memory preemptive refresh path as long as the in-memory cache
  has `ttlLeftBeforeRefreshInMsecs` set. `InMemoryCache` and `InMemoryGroupCache` gained `resetTtl` /
  `resetTtlFromGroup` to support this. When both tiers have a refresh window, the async cache takes
  precedence, so existing configurations are unaffected.
- `GroupLoader.forceSetValueForGroup`, the group counterpart to `Loader.forceSetValue`.

### Changed

- `GroupLoader` now propagates the value fetched during a preemptive background refresh into the
  in-memory group cache, matching `Loader`'s existing behavior. Previously the in-memory group layer
  kept serving the pre-refresh value until its own TTL expired. This affects every two-layer
  `GroupLoader` setup that has `ttlLeftBeforeRefreshInMsecs` configured, independently of whether the
  new `isEntryStillCurrentFn` option is used.
