import { existsSync, readFileSync } from 'node:fs'
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
})
