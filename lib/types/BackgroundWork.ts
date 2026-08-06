/**
 * Why the loader started a piece of work it does not await.
 *
 * This is a closed set on purpose: hosts branch on it in practice, whatever the documentation says,
 * so it is treated as part of the public contract rather than as a free-form log string. Adding a
 * member is a minor version bump; renaming one is a major.
 *
 * - `refresh` - a preemptive background refresh (or the staleness probe and TTL bump that may
 *   replace it), including the expiration-time lookup that decides whether the refresh is due.
 * - `notification` - a publish to the notification channel, so other nodes learn that an entry was
 *   invalidated or overwritten here.
 */
export type BackgroundWorkReason = 'refresh' | 'notification'

export type BackgroundWorkMeta = {
  /**
   * The `cacheId` configured on `inMemoryCache`, if any. Intended for host-side logging, so that
   * work from several loaders can be told apart.
   */
  cacheId: string | undefined
  reason: BackgroundWorkReason
}

/**
 * Hook for work the loader starts and does not await.
 *
 * By default such work is simply left to run detached (`void work`), which is correct on Node. It is
 * not correct on runtimes where I/O is scoped to the request that created it - notably Cloudflare
 * Workers and other isolate runtimes, where a promise that outlives its request fails with
 * "Cannot perform I/O on behalf of a different request" unless it was handed to
 * `ctx.waitUntil()`. Supplying this hook gives the host the promise so it can do exactly that.
 *
 * It is also useful on Node: tests can await quiescence instead of sleeping, and a shutdown path
 * can drain in-flight refreshes before closing connections.
 *
 * The promise passed to the hook is guaranteed to settle *fulfilled*: the loader has already routed
 * any error to the configured `loadErrorHandler` / `cacheUpdateErrorHandler` / publisher error
 * handler and attached its own handler before handing it over. That guarantee matters, because
 * `ctx.waitUntil()` on a rejecting promise fails the request that adopted it.
 *
 * The hook is supplied once, at construction, but the request context it usually needs is per
 * request - so it must resolve that context at call time rather than close over one. On an isolate
 * runtime the loader must be constructed at isolate scope (a loader rebuilt per request is a memo,
 * not a cache), which means a `ctx` captured at construction belongs to whichever request happened
 * to build the loader, and using it later reintroduces the very fault this hook exists to avoid.
 * Read the ambient context instead:
 *
 * ```ts
 * const requestCtx = new AsyncLocalStorage<ExecutionContext>()
 *
 * const loader = new Loader({
 *   inMemoryCache: { ttlInMsecs: 60_000 },
 *   scheduleBackgroundWork: (work) => {
 *     const ctx = requestCtx.getStore()
 *     if (ctx) {
 *       ctx.waitUntil(work)
 *     } else {
 *       void work
 *     }
 *   },
 * })
 * ```
 */
export type BackgroundWorkScheduler = (work: Promise<void>, meta: BackgroundWorkMeta) => void
