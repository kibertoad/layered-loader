# CLAUDE.md

Guidance for Claude Code when working in this repository. Behaviour that consumers need to know is
documented in `README.md` — keep it there, and keep this file to instructions that only matter to
someone changing the code.

## Pull requests

**Every PR must carry exactly one semver label: `patch`, `minor`, or `major`.** The release pipeline
(`.github/workflows/publish.yml`) derives the version bump from that label, so a PR merged without one
publishes nothing.

Pick it from the effect on the published API:

- `patch` — bug fixes, docs, internal refactors, dependency bumps with no API impact.
- `minor` — new exports, new entrypoints, new optional config; anything additive.
- `major` — removed or renamed exports, changed defaults, a raised `engines` floor, moving a runtime
  dependency to a peer, or anything else that requires consumers to touch their code.

Changes confined to `benchmark/`, `.github/` or `test/` still want a `patch` label; the workflow
detects that nothing publishable changed and skips the release on its own.

## Package entrypoints

`core.ts` → `layered-loader/core`, `redis.ts` → `layered-loader/redis`, `index.ts` → `export *` of
both. README's "Entrypoints" section documents what each one contains and what it guarantees.

- Add a new export to `core.ts` or `redis.ts`, never to `index.ts`.
- Nothing reachable from `core.ts` may import `ioredis` or a `node:` builtin.
- Nothing under `lib/` may import `ioredis` at all — not even `import type`, which lands in the emitted
  `.d.ts` and breaks consumers who never installed the optional peer. Use the vendored structural types
  in `lib/redis/RedisLike.ts`, and extend them when you start calling a command they do not cover.
- Reach the `ioredis` value only through the lazy `createRequire` in `lib/redis/resolveRedisClient.ts`.
  A static import anywhere would make `layered-loader/redis` fail to resolve for everyone who did not
  install the peer.
- Constrain generics over Redis options to `object`, not to an all-optional shape. All-optional shapes
  are "weak types", so TypeScript rejects object literals like `enrichRedisConfig({ host, port })`;
  adding an index signature instead rejects interfaces such as `RedisOptions`.
- `pnpm run lint:redis-compat` type-checks the vendored declarations against the real `ioredis` types.
  Match what `ioredis` declares — never widen a vendored signature to silence it.
- `test/entrypoints.spec.ts` builds the package and checks the emitted output. When it fails, move the
  import; do not relax the test. Do not rewrite it to scan the TypeScript sources: pattern-matching
  `import type` is unreliable and previously let a broken invariant pass.

The optional-peer arrangement rests on three independent things — the lazy runtime `require`, the
vendored types, and the optional peer declaration in `package.json`. Each has its own guard in
`test/entrypoints.spec.ts`; break one and the arrangement is gone.

## Rules for code that does not exist yet

`test/remoteInvalidation.spec.ts` and `test/backgroundWork.spec.ts` pin the invalidation and
background-work behaviour, and `tsc` pins the consumer typing, so those need nothing here. These three
constrain call sites that have not been written, which no test can cover:

- **A background path that writes into the in-memory tier outside `getAsyncOnlyResolved` holds no
  `runningLoads` entry, so invalidation does not fence it.** Open a fence token
  (`openBackgroundWriteFence` / `isBackgroundWriteFenceIntact` / `closeBackgroundWriteFence`) as
  `refreshOrBumpTtl` does, and keep the map holding only keys with work in flight.
- **Every fire-and-forget promise goes through `AbstractCache.runInBackground(work, reason)`**,
  reports its own errors to the configured handlers first, and `return`s any inner chain rather than
  detaching it. Detached elsewhere, an isolate host cannot adopt it; rejecting, it fails the request
  that adopted it; dropping its continuation, it gets adopted only in part.
- **Anything new that applies state originating elsewhere joins the `applyRemote*` family and stays
  synchronous** — a pull-transport host calls these at request start and should not have to await.

## Working in this repo

- Node 22+, ESM-only, pnpm. `pnpm run lint` runs both Biome and `tsc --noEmit`.
- `pnpm run test` needs a local Redis for `test/redis/**`: `pnpm run docker:start` first.
- Coverage thresholds are enforced (100% lines/statements); new `lib/` code needs tests.
- `pnpm run lint:packaging` runs `publint` and `attw` — run it after touching the `exports` map.
- New root-level source files must be added to the changed-path `case` in `publish.yml`, otherwise the
  release pipeline will not consider them a publishable change.
