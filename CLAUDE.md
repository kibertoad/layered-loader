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
- Outside `lib/redis/`, `ioredis` may only ever be imported as `import type`. Inside `lib/redis/`,
  `lib/redis/resolveRedisClient.ts` is the single place that uses `Redis` as a value. Keep that
  import static — a lazy `createRequire` hides the dependency from every bundler, which silently
  drops `ioredis` from bundles that need it, and `sideEffects: false` already covers the case where
  it is not needed.
- `test/entrypoints.spec.ts` enforces all of the above by compiling the package and importing each
  entrypoint in a child process with a resolve hook installed, so it sees exactly what Node loads —
  static imports, dynamic `import()` and `require()` alike. If it fails, the fix is to move the
  import, not to relax the test. Do not replace it with source scanning: distinguishing
  `import type` from a value import by pattern-matching TypeScript is what it used to do, and it
  could silently pass while the invariant was broken.

## Working in this repo

- Node 22+, ESM-only, pnpm. `pnpm run lint` runs both Biome and `tsc --noEmit`.
- `pnpm run test` needs a local Redis for `test/redis/**`: `pnpm run docker:start` first.
- Coverage thresholds are enforced (100% lines/statements); new `lib/` code needs tests.
- `pnpm run lint:packaging` runs `publint` and `attw` — run it after touching the `exports` map.
- New root-level source files must be added to the changed-path `case` in `publish.yml`, otherwise
  the release pipeline will not consider them a publishable change.
