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
- `test/entrypoints.spec.ts` enforces the above by walking the static import graph and asserting the
  manifest. If it fails, the fix is to move the import, not to relax the test.

## Working in this repo

- Node 22+, ESM-only, pnpm. `pnpm run lint` runs both Biome and `tsc --noEmit`.
- `pnpm run test` needs a local Redis for `test/redis/**`: `pnpm run docker:start` first.
- Coverage thresholds are enforced (100% lines/statements); new `lib/` code needs tests.
- `pnpm run lint:packaging` runs `publint` and `attw` — run it after touching the `exports` map.
- New root-level source files must be added to the changed-path `case` in `publish.yml`, otherwise
  the release pipeline will not consider them a publishable change.
