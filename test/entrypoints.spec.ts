import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The entrypoints are checked against a real compilation, loaded in a real Node process, rather
 * than by scanning the TypeScript sources. Source scanning is what an earlier version of this file
 * did, and it could not tell `import type` from a value import reliably enough to be trusted — a
 * guard that can silently pass is worse than no guard.
 *
 * Checking the emitted output instead is both simpler and stricter. The compiler has already erased
 * type-only imports, so whatever is left in a `.js` file is real; and `ioredis` leaking into the
 * types consumers compile against is precisely "the string `ioredis` appears in a `.d.ts`", with no
 * parsing required. Loading the result also covers dynamic `import()` and `require()`, neither of
 * which source scanning can see.
 *
 * Built into `node_modules/` rather than `dist/` so that running the tests never clobbers a
 * developer's build output, and so that Node still resolves bare specifiers such as `toad-cache`
 * by walking up to this package's own `node_modules`.
 */
const BUILD_DIR = join(PACKAGE_ROOT, 'node_modules', '.cache', 'entrypoint-check')
const PROBE_PATH = join(BUILD_DIR, 'probe.mjs')
const RESULT_PATH = join(BUILD_DIR, 'result.json')

/**
 * Imports one entrypoint with a resolve hook installed, and records every bare specifier resolved
 * while it loads. Relative and absolute specifiers are the package's own files; anything bare is a
 * dependency the entrypoint pulls in, including `node:` builtins.
 *
 * The result goes to a file rather than to stdout, so that anything an imported module happens to
 * print cannot corrupt it.
 */
const PROBE_SOURCE = `import { writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'

const [, , entrypoint, resultPath] = process.argv
const loaded = new Set()

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!/^([./]|file:)/.test(specifier)) {
      loaded.add(specifier)
    }
    return nextResolve(specifier, context)
  },
})

const namespace = await import(entrypoint)

writeFileSync(
  resultPath,
  JSON.stringify({ loaded: [...loaded].sort(), exports: Object.keys(namespace).sort() }),
)
`

type EntrypointReport = {
  /** Bare specifiers resolved while importing the entrypoint. */
  loaded: string[]
  /** Runtime (value) exports of the entrypoint. */
  exports: string[]
}

const reports = new Map<string, EntrypointReport>()

function reportFor(entrypoint: string): EntrypointReport {
  const report = reports.get(entrypoint)
  if (!report) {
    throw new Error(`No report was collected for ${entrypoint}`)
  }
  return report
}

function subpathExports(): string[] {
  return [...reportFor('core.js').exports, ...reportFor('redis.js').exports]
}

/**
 * Every way a module can reference `ioredis` in emitted code or declarations: a `from` clause, and
 * the `import('ioredis')` form TypeScript emits for inline type references. Deliberately not a bare
 * substring match — doc comments survive into `.d.ts`, and a comment mentioning `ioredis` creates no
 * dependency on it. Equally deliberately not matching `require('ioredis')`, which is the sanctioned
 * lazy path in `resolveRedisClient`.
 */
const IOREDIS_MODULE_REFERENCE = /\bfrom\s*['"]ioredis['"]|\bimport\s*\(\s*['"]ioredis['"]\s*\)/

/** Emitted files with the given extension that reference the `ioredis` module, by relative path. */
function emittedFilesReferencingIoredis(extension: string): string[] {
  return readdirSync(BUILD_DIR, { recursive: true, encoding: 'utf8' })
    .filter((entry) => entry.endsWith(extension))
    .filter((entry) => IOREDIS_MODULE_REFERENCE.test(readFileSync(join(BUILD_DIR, entry), 'utf8')))
}

beforeAll(() => {
  rmSync(BUILD_DIR, { recursive: true, force: true })
  mkdirSync(BUILD_DIR, { recursive: true })

  // A dedicated compilation, rather than a dependency on `pnpm run build` having been run first,
  // so that `pnpm run test` stays self-contained on a fresh clone.
  execFileSync(join(PACKAGE_ROOT, 'node_modules', '.bin', 'tsc'), ['--outDir', BUILD_DIR], {
    cwd: PACKAGE_ROOT,
    stdio: 'pipe',
  })

  writeFileSync(PROBE_PATH, PROBE_SOURCE)

  for (const entrypoint of ['core.js', 'index.js', 'redis.js']) {
    execFileSync('node', [PROBE_PATH, join(BUILD_DIR, entrypoint), RESULT_PATH], { stdio: 'pipe' })
    reports.set(entrypoint, JSON.parse(readFileSync(RESULT_PATH, 'utf8')) as EntrypointReport)
  }
}, 120_000)

describe('entrypoints', () => {
  describe('layered-loader/core', () => {
    it('loads nothing but toad-cache — no ioredis, and no node: builtins', () => {
      // Guards the Cloudflare Workers / workerd use-case. Asserted verbatim rather than as an
      // absence of `ioredis`, because a `node:` import anywhere in the graph — including inside a
      // transitive dependency — breaks that use-case just as thoroughly.
      expect(reportFor('core.js').loaded).toEqual(['toad-cache'])
    })
  })

  describe('layered-loader', () => {
    it('exposes exactly the union of the two subpath entrypoints', () => {
      expect(new Set(reportFor('index.js').exports)).toEqual(new Set(subpathExports()))
    })

    it('does not export the same name from both subpath entrypoints', () => {
      // Only value exports are observable at runtime. A *type* exported from both subpath
      // entrypoints cannot slip through either, because `export *` over a duplicated name is a
      // compile error (TS2308), which `pnpm run lint` catches via `tsc --noEmit`.
      expect(subpathExports()).toHaveLength(new Set(subpathExports()).size)
    })
  })

  describe('ioredis as an optional peer dependency', () => {
    it('is not loaded by any entrypoint at import time', () => {
      // The optional peer may be absent, so importing any entrypoint has to work without it.
      // `ioredis` is reached only through the lazy `require` in `resolveRedisClient`, which does
      // not run until a client is actually constructed from connection options.
      for (const entrypoint of ['core.js', 'index.js', 'redis.js']) {
        expect(reportFor(entrypoint).loaded).not.toContain('ioredis')
      }
    })

    it('is not referenced by any emitted type declaration', () => {
      // The load-bearing guarantee for consumers who never install the optional peer: a single
      // `import type { Redis } from 'ioredis'` anywhere under `lib/` lands in the emitted `.d.ts`
      // and breaks their type-check. The vendored structural types in `lib/redis/RedisLike.ts`
      // exist for exactly this reason, and `test/ioredisCompat.type-test.ts` keeps them honest
      // against the real declarations.
      expect(emittedFilesReferencingIoredis('.d.ts')).toEqual([])
    })

    it('is not statically imported by any emitted module', () => {
      // Type-only imports are already erased at this point, so any reference left in the emitted
      // JavaScript is a real static import that would load `ioredis` eagerly.
      expect(emittedFilesReferencingIoredis('.js')).toEqual([])
    })

    it('is declared as an optional peer dependency rather than a dependency', () => {
      const manifest = JSON.parse(readFileSync(resolve(PACKAGE_ROOT, 'package.json'), 'utf8'))

      expect(manifest.dependencies).not.toHaveProperty('ioredis')
      expect(manifest.peerDependencies).toHaveProperty('ioredis')
      expect(manifest.peerDependenciesMeta.ioredis.optional).toBe(true)
    })
  })
})
