# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Pull requests

**Every PR must carry exactly one semver label: `patch`, `minor`, or `major`.**

The release pipeline (`.github/workflows/publish.yml`) only runs when a merged PR carries one of
those three labels, and it derives the version bump directly from the label. A PR merged without a
semver label publishes nothing, so the change silently never reaches npm.

Pick the label from the effect on the published API:

- `patch` — bug fixes, docs, internal refactors, dependency bumps with no API impact.
- `minor` — new exports, new entrypoints, new optional config options; anything additive that
  existing consumers keep working through unchanged.
- `major` — removed or renamed exports, changed defaults, raised `engines` floor, or any change
  that requires consumers to touch their code.

Changes confined to non-publishable paths (`benchmark/`, `.github/`, `test/`) still want a `patch`
label; the workflow detects that no publishable source changed and skips the release on its own.

## Package entrypoints

The package exposes three entrypoints, and the split between them is load-bearing — not just
organisational:

- `layered-loader/core` (`core.ts`) — loaders, manual caches, in-memory caches, the notification
  base class and publisher interfaces, key resolvers, and all types. **Nothing reachable from this
  file may import `ioredis`, or any `node:` builtin.** This is the entrypoint that consumers on
  Cloudflare Workers and other edge runtimes import.
- `layered-loader/redis` (`redis.ts`) — the Redis caches, notification factories, publishers and
  consumers. The only entrypoint whose exports may reach `ioredis`.
- `layered-loader` (`index.ts`) — `export *` of both, so the root stays a superset of the two.

Rules that follow from that:

- A new export goes into `core.ts` or `redis.ts`, never into `index.ts` directly.
- **Nothing under `lib/` may import `ioredis` at all** — not even with `import type`, which would
  land in the emitted `.d.ts` and break consumers who never installed the optional peer. Use the
  vendored structural types in `lib/redis/RedisLike.ts` instead, and extend those if you start
  calling a Redis command they do not cover.
- `test/ioredisCompat.type-test.ts` type-checks the vendored declarations against the real `ioredis`
  types; `pnpm run lint:redis-compat` runs it and is part of `pnpm run lint`. Widening a vendored
  signature to silence it is wrong — match what `ioredis` actually declares.
- Constrain generics over Redis options to `object`, not to an all-optional shape. All-optional
  shapes are "weak types" and TypeScript then rejects object literals like
  `enrichRedisConfig({ host, port })`; adding an index signature instead rejects interfaces such as
  `RedisOptions`, which never get an implicit one.
- The value of `ioredis` is only ever reached through `lib/redis/resolveRedisClient.ts`, which
  resolves it lazily via `createRequire` and throws an actionable error when it is not installed.
  Keep it lazy: a static import would make `layered-loader/redis` fail to resolve for everyone who
  did not install the optional peer, which is the whole point of the arrangement. The cost is that
  bundlers cannot see through `createRequire` and will not inline `ioredis` — that is the correct
  trade-off for a peer dependency, and README.md documents it under "Bundling" so consumers are not
  surprised by it.
- `test/entrypoints.spec.ts` enforces the above against a real compilation: it builds the package
  into `node_modules/.cache`, imports each entrypoint in a child process with a resolve hook
  installed, and scans the emitted output. That covers what Node actually loads (static imports,
  dynamic `import()` and `require()` alike), plus `ioredis` leaking into an emitted `.d.ts`. If it
  fails, the fix is to move the import, not to relax the test.

  Do not rewrite it to scan the TypeScript sources. It used to, and telling `import type` from a
  value import by pattern-matching TypeScript is not reliable — `export type Foo = ...` on the line
  above an import made the guard swallow that import and mark it type-only, so it could pass while
  the invariant was broken. Checking emitted output has no such ambiguity: the compiler has already
  erased the type-only imports.

## Originating an invalidation vs applying one

These are two different operations and the distinction is load-bearing, not cosmetic:

- `invalidateCacheFor` / `invalidateCacheForGroup` / `invalidateCache` **originate** one: they delete
  from the async tier, fence running loads, delete in-memory, and **publish**.
- `applyRemoteInvalidationFor` / `applyRemoteInvalidationForGroup` / `applyRemoteValue` /
  `applyRemoteInvalidation` **apply** one that came from somewhere else: they fence running loads and
  delete in-memory, and deliberately do **not** touch the async tier (the origin already did, it is
  shared) and do **not** publish (the origin already broadcast it — re-publishing echoes it back onto
  the bus).

Notification consumers must go through the second set. `AbstractCache` hands the consumer a facade
over the owning cache — not `this.inMemoryCache` — so `targetCache.delete(key)` fences running loads.
That fencing is the whole point: before it existed, a `DELETE` that arrived while a load for the same
key was in flight was silently undone when the load resolved and wrote its pre-invalidation snapshot
back. `test/remoteInvalidation.spec.ts` pins both halves.

"Fence" means two things, and both matter:

- **Running loads.** Every invalidation path goes through `AbstractFlatCache.evictRunningLoad` /
  `AbstractGroupCache.evictGroupRunningLoad` / `AbstractCache.evictAllRunningLoads` rather than
  touching `runningLoads` directly. Do not reintroduce a bare `this.runningLoads.delete(key)` in an
  invalidation path — the load-completion bookkeeping in `getAsyncOnlyResolved` is the one place that
  legitimately deletes directly, because a load finishing normally must *not* cancel a concurrent
  refresh.
- **Background write fences.** The async-tier preemptive refresh (`Loader.refreshOrBumpTtl`,
  `GroupLoader.refreshOrBumpTtl`) reloads straight from the data sources and writes into the
  in-memory tier without holding a `runningLoads` entry, so `runningLoads` alone does not fence it.
  It opens a per-key fence token instead, and skips its in-memory write if an invalidation broke the
  fence meanwhile. Any new background path that writes in-memory outside `getAsyncOnlyResolved` needs
  the same treatment. The fence map only holds keys with a refresh in flight, so it is bounded by
  refresh concurrency, not by key cardinality — keep it that way.

What the fence deliberately does not cover is the shared async tier: a refresh that already read from
the data sources still writes that value to Redis. That is the ordinary read-through race (a plain
cache miss has it too) and needs versioning at the store, not a local fence. README.md says so
explicitly under "Applying invalidations from your own transport"; do not upgrade that claim.

Consequences to preserve:

- Consumers are typed over `SynchronousCache` / `SynchronousGroupCache`, never over the concrete
  `InMemoryCache` / `InMemoryGroupCache` — the facade is not one of those, and a concrete class type
  would not accept it (private fields defeat structural assignment).
- Do not "simplify" `createRemoteInvalidationTarget` back into passing `this.inMemoryCache`.
- Anything new that applies remote state belongs in the `applyRemote*` family, and must stay
  synchronous: a pull-transport host calls these at request start and should not have to await.

## Background work

Every fire-and-forget promise goes through `AbstractCache.runInBackground(work, reason)`, which hands
it to the optional `scheduleBackgroundWork` config hook or leaves it detached when there is none.
New fire-and-forget call sites must route through it too, or an isolate-runtime host loses the
ability to adopt them with `ctx.waitUntil()`.

Two invariants:

- **The promise handed over must settle fulfilled.** `runInBackground` wraps it, but the call site
  still owns reporting its own errors to the configured handlers first — `ctx.waitUntil()` on a
  rejecting promise fails the request that adopted it. "Reporting" means the configured handler, not
  `logger.error`: swallowing a failure into the logger makes it invisible to a host that configured
  `loadErrorHandler` / `cacheUpdateErrorHandler`. The expiration lookup that opens the async-tier
  refresh goes through `loadErrorHandler` for exactly this reason (the default handler still logs).
- **The promise must cover the whole operation.** Where a background chain kicks off further work
  (the expiration lookup that decides whether a refresh is due, then the refresh), the inner chain is
  `return`ed rather than detached, so the host adopts the refresh and not just the lookup. Nothing
  awaits these chains otherwise, so returning them changes no timing.

`BackgroundWorkReason` is a closed union. Hosts branch on it, so adding a member is a minor bump and
renaming one is a major.

## Why `ioredis` is an optional peer dependency

Recorded here so the trade-off is not re-litigated. `ioredis` is not a `dependency`; it is a
`peerDependency` with `peerDependenciesMeta.ioredis.optional`. Consumers who use Redis declare it
themselves — which most already do, since `RedisCache` takes a client they construct.

What makes it work is that three separate things all avoid `ioredis`:

- **Runtime** — reached only through the lazy `require` in `resolveRedisClient`, so every entrypoint
  imports cleanly when it is absent.
- **Types** — vendored structurally in `RedisLike.ts`, so no emitted `.d.ts` mentions it and
  consumers type-check without it.
- **Install** — an optional peer is not installed unless asked for.

Remove any one of the three and the arrangement collapses, which is why each has its own guard in
`test/entrypoints.spec.ts`.

Note the release consequence: moving `ioredis` out of `dependencies` breaks any consumer who relied
on it being installed transitively, so it is a **major** version bump, never a patch or minor.

Also worth knowing: `@layered-loader/sqs` gives consumers cross-instance invalidation with no Redis
at all, and imports from `layered-loader/core`. Point people there before they reach for Redis.

## Working in this repo

- Node 22+, ESM-only, pnpm. `pnpm run lint` runs both Biome and `tsc --noEmit`.
- `pnpm run test` needs a local Redis for `test/redis/**`: `pnpm run docker:start` first.
- Coverage thresholds are enforced (100% lines/statements); new `lib/` code needs tests.
- `pnpm run lint:packaging` runs `publint` and `attw` — run it after touching the `exports` map.
- New root-level source files must be added to the changed-path `case` in `publish.yml`, otherwise
  the release pipeline will not consider them a publishable change.
