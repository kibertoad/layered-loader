# Changelog

## Unreleased

### Added

- Two new subpath entrypoints, so Redis is optional at runtime and at the type level (`ioredis`
  remains a regular `dependency` and is still installed for every consumer):
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
  `createGroupNotificationPair` where a client is constructed from `RedisOptions` rather than passed
  in. No file in the package imports it statically any more, so even importing the package root no
  longer loads Redis at runtime.
- `@layered-loader/sqs` imports from `layered-loader/core`, so the SNS/SQS adapter no longer pulls
  Redis types or code into its consumers' graphs.

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
