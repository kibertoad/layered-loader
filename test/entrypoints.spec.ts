import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as coreEntrypoint from '../core.js'
import * as rootEntrypoint from '../index.js'
import * as redisEntrypoint from '../redis.js'

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Matches `import ... from 'x'` / `export ... from 'x'`, capturing whether it is type-only. */
const REEXPORT_REGEX =
  /^[ \t]*(?<kind>import|export)[ \t]+(?<typeOnly>type[ \t]+)?[\s\S]*?\bfrom[ \t]*['"](?<specifier>[^'"]+)['"]/gm
/** Matches side-effect-only imports, e.g. `import 'x'`. */
const SIDE_EFFECT_IMPORT_REGEX = /^[ \t]*import[ \t]*['"](?<specifier>[^'"]+)['"]/gm

type ImportRecord = {
  specifier: string
  typeOnly: boolean
}

function parseImports(source: string): ImportRecord[] {
  const imports: ImportRecord[] = []

  for (const match of source.matchAll(REEXPORT_REGEX)) {
    imports.push({
      specifier: match.groups!.specifier,
      typeOnly: Boolean(match.groups!.typeOnly),
    })
  }
  for (const match of source.matchAll(SIDE_EFFECT_IMPORT_REGEX)) {
    imports.push({ specifier: match.groups!.specifier, typeOnly: false })
  }

  return imports
}

/** Resolves a relative ESM specifier (`./x.js`) back to the TypeScript source it is emitted from. */
function resolveSourceFile(fromFile: string, specifier: string): string {
  const resolved = resolve(dirname(fromFile), specifier)
  for (const candidate of [resolved.replace(/\.js$/, '.ts'), resolved, `${resolved}.ts`]) {
    if (existsSync(candidate)) {
      return candidate
    }
  }
  throw new Error(`Could not resolve "${specifier}" from ${relative(PACKAGE_ROOT, fromFile)}`)
}

/** Every source file statically reachable from the given entrypoint, entrypoint included. */
function collectModuleGraph(entrypoint: string): Map<string, ImportRecord[]> {
  const graph = new Map<string, ImportRecord[]>()
  const queue = [resolve(PACKAGE_ROOT, entrypoint)]

  while (queue.length > 0) {
    const file = queue.pop()!
    if (graph.has(file)) {
      continue
    }

    const imports = parseImports(readFileSync(file, 'utf8'))
    graph.set(file, imports)

    for (const importRecord of imports) {
      // Type-only imports are erased at compile time, so they never reach the runtime graph.
      if (importRecord.typeOnly || !importRecord.specifier.startsWith('.')) {
        continue
      }
      queue.push(resolveSourceFile(file, importRecord.specifier))
    }
  }

  return graph
}

/** Every source file that ends up in `dist/` — the three entrypoints plus everything under `lib/`. */
function shippedSourceFiles(): string[] {
  const files = ['core.ts', 'redis.ts', 'index.ts'].map((entry) => resolve(PACKAGE_ROOT, entry))

  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = resolve(directory, entry.name)
      if (entry.isDirectory()) {
        walk(entryPath)
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
        files.push(entryPath)
      }
    }
  }
  walk(resolve(PACKAGE_ROOT, 'lib'))

  return files
}

function runtimeDependenciesOf(entrypoint: string): string[] {
  const dependencies = new Set<string>()

  for (const imports of collectModuleGraph(entrypoint).values()) {
    for (const importRecord of imports) {
      if (!importRecord.typeOnly && !importRecord.specifier.startsWith('.')) {
        dependencies.add(importRecord.specifier)
      }
    }
  }

  return [...dependencies].sort()
}

describe('entrypoints', () => {
  describe('layered-loader/core', () => {
    it('never reaches ioredis at runtime', () => {
      expect(runtimeDependenciesOf('core.ts')).not.toContain('ioredis')
    })

    it('has no Node-specific runtime dependencies, so it can run on edge runtimes', () => {
      // Guards the Cloudflare Workers / workerd use-case: adding a `node:` import anywhere in
      // the core graph silently breaks it, so the whole dependency list is asserted verbatim.
      expect(runtimeDependenciesOf('core.ts')).toEqual(['toad-cache'])
    })
  })

  describe('layered-loader', () => {
    it('loads ioredis lazily, so even the root entrypoint does not pull it in', () => {
      // `ioredis` may only ever be reached through a runtime `require` inside
      // `resolveRedisClient`, never through a static import.
      expect(runtimeDependenciesOf('index.ts')).not.toContain('ioredis')
    })

    it('exposes exactly the union of the core and redis entrypoints', () => {
      const subpathExports = [...Object.keys(coreEntrypoint), ...Object.keys(redisEntrypoint)]

      expect(new Set(Object.keys(rootEntrypoint))).toEqual(new Set(subpathExports))
      // No export is duplicated between the two subpath entrypoints.
      expect(subpathExports).toHaveLength(new Set(subpathExports).size)
    })
  })

  describe('ioredis as an optional peer dependency', () => {
    it('is not imported by any shipped source file, as a value or as a type', () => {
      // `ioredis` is an optional peer, so it may be missing at install time. Nothing under `lib/`
      // may reference it — not even with `import type`, since that would land in the emitted
      // `.d.ts` and break consumers who never installed it. The vendored structural types in
      // `lib/redis/RedisLike.ts` exist for exactly this reason, and
      // `test/ioredisCompat.type-test.ts` keeps them honest against the real declarations.
      const offenders = shippedSourceFiles()
        .filter((file) =>
          parseImports(readFileSync(file, 'utf8')).some((i) => i.specifier === 'ioredis'),
        )
        .map((file) => relative(PACKAGE_ROOT, file))

      expect(offenders).toEqual([])
    })

    it('is declared as an optional peer dependency rather than a dependency', () => {
      const manifest = JSON.parse(readFileSync(resolve(PACKAGE_ROOT, 'package.json'), 'utf8'))

      expect(manifest.dependencies).not.toHaveProperty('ioredis')
      expect(manifest.peerDependencies).toHaveProperty('ioredis')
      expect(manifest.peerDependenciesMeta.ioredis.optional).toBe(true)
    })
  })
})
