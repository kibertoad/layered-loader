# Changelog

## Unreleased

### Added

- Optional `isEntryStillCurrentFn` staleness checker for conditional cache refresh. When a cached
  entry enters the `ttlLeftBeforeRefreshInMsecs` window, the loader can run a lightweight freshness
  check instead of unconditionally refetching, and reset the entry's TTL when it is still current.
  Backed by new optional `resetTtl` / `resetTtlFromGroup` cache methods (implemented by `RedisCache`
  and `RedisGroupCache`). See the README section "Conditional refresh with a staleness check".
- `GroupLoader.forceSetValueForGroup`, the group counterpart to `Loader.forceSetValue`.

### Changed

- `GroupLoader` now propagates the value fetched during a preemptive background refresh into the
  in-memory group cache, matching `Loader`'s existing behavior. Previously the in-memory group layer
  kept serving the pre-refresh value until its own TTL expired. This affects every two-layer
  `GroupLoader` setup that has `ttlLeftBeforeRefreshInMsecs` configured, independently of whether the
  new `isEntryStillCurrentFn` option is used.
