import {
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  ListQueueTagsCommand,
  ListQueuesCommand,
  TagQueueCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs'
import {
  ListSubscriptionsByTopicCommand,
  UnsubscribeCommand,
  type SNSClient,
} from '@aws-sdk/client-sns'

/**
 * Tag key written by the consumer's heartbeat and read by {@link reapStaleQueues}.
 * Value is a unix-epoch millisecond timestamp as a string.
 */
export const HEARTBEAT_TAG_KEY = 'layered-loader:heartbeat'

/** Default heartbeat cadence used when {@link HeartbeatOptions.intervalMs} is omitted. */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 60_000

/** Default idle threshold used by {@link reapStaleQueues} when none is provided. */
export const DEFAULT_REAPER_IDLE_THRESHOLD_MS = 300_000

export type HeartbeatOptions = {
  /**
   * How often to refresh the heartbeat tag on the queue.
   * Defaults to {@link DEFAULT_HEARTBEAT_INTERVAL_MS}.
   *
   * Pick a value comfortably smaller than the reaper's idle threshold —
   * a 3x margin (e.g. 60s heartbeat, 5min idle) tolerates one missed beat
   * without false-positive reaping.
   */
  intervalMs?: number
  /**
   * Invoked when a heartbeat write fails (e.g. transient SQS error). The next
   * tick proceeds regardless; this hook is for observability only.
   */
  errorHandler?: (err: Error) => void
}

export type QueueLifecycleOptions = {
  /**
   * If true, calling `close()` on the consumer will issue a `DeleteQueueCommand`
   * for the consumer's own SQS queue after stopping the message loop. Missing
   * queues are treated as success.
   */
  deleteQueueOnClose?: boolean
  /**
   * If true, calling `close()` on the consumer will issue an `UnsubscribeCommand`
   * for the consumer's SNS subscription before deleting the queue. Missing
   * subscriptions are treated as success.
   */
  unsubscribeOnClose?: boolean
  /**
   * Enables periodic heartbeat tagging on the consumer's queue. Required for
   * {@link reapStaleQueues} to distinguish abandoned queues from idle-but-live
   * ones. Pass `{}` to use the defaults.
   */
  heartbeat?: HeartbeatOptions
  /**
   * Invoked when the cleanup step on `close()` fails. Cleanup is best-effort —
   * the consumer always considers itself closed even if the AWS calls fail.
   */
  onCleanupError?: (err: Error, step: 'unsubscribe' | 'deleteQueue') => void
}

export type HeartbeatRunner = {
  /** Stop the heartbeat loop. Idempotent; safe to call after the consumer is closed. */
  stop(): void
}

/**
 * Starts a periodic tag-update loop on a queue. Used by consumers that opt
 * into the heartbeat-based reaper. The first tag is written eagerly so a
 * reaper that runs immediately sees a fresh queue.
 *
 * The timer is `unref`'d so it does not keep the Node event loop alive.
 */
export function startQueueHeartbeat(params: {
  sqsClient: SQSClient
  queueUrl: string
  intervalMs?: number
  errorHandler?: (err: Error) => void
}): HeartbeatRunner {
  const intervalMs = params.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error(
      `startQueueHeartbeat: intervalMs must be a positive number (got ${intervalMs})`,
    )
  }
  let stopped = false
  // Reentrancy guard: TagQueue calls can exceed intervalMs under throttling
  // or cold-start TLS; we skip overlapping ticks rather than piling up
  // unbounded in-flight requests against the SQS client.
  let inFlight = false

  const tick = async () => {
    if (stopped || inFlight) return
    inFlight = true
    try {
      await params.sqsClient.send(
        new TagQueueCommand({
          QueueUrl: params.queueUrl,
          Tags: { [HEARTBEAT_TAG_KEY]: Date.now().toString() },
        }),
      )
    } catch (err) {
      try {
        params.errorHandler?.(err as Error)
      } catch {
        // Swallow handler-thrown errors — they would otherwise surface as
        // unhandledRejection from the fire-and-forget tick path.
      }
    } finally {
      inFlight = false
    }
  }

  // Fire-and-forget the eager beat so the queue is tagged before subscribe()
  // returns; we deliberately do not await it (would slow startup).
  void tick()

  const timer = setInterval(tick, intervalMs)
  if (typeof timer.unref === 'function') timer.unref()

  return {
    stop() {
      if (stopped) return
      stopped = true
      clearInterval(timer)
    },
  }
}

export type ReapStaleQueuesParams = {
  sqsClient: SQSClient
  /**
   * Optional SNS client. When provided, the reaper also unsubscribes any
   * SNS subscriptions whose `Endpoint` points at one of the deleted queue ARNs.
   * Requires {@link topicArn} (or {@link topicArns}) so the reaper knows which
   * topic(s) to scan.
   */
  snsClient?: SNSClient
  /**
   * One or more SNS topic ARNs to scan for orphan subscriptions. Only used when
   * {@link snsClient} is set.
   */
  topicArn?: string
  /** Convenience: array form of {@link topicArn}. */
  topicArns?: readonly string[]
  /**
   * Only consider queues whose name starts with this prefix. Strongly
   * recommended — without it the reaper would scan every queue in the account.
   */
  queueNamePrefix: string
  /**
   * Queues whose heartbeat tag is older than this are deleted. Queues with
   * no heartbeat tag at all are also eligible if their `CreatedTimestamp` is
   * older than the threshold (covers queues from before heartbeat tagging was
   * enabled, or pre-existing manual queues).
   *
   * Defaults to {@link DEFAULT_REAPER_IDLE_THRESHOLD_MS}.
   */
  idleThresholdMs?: number
  /**
   * If true, log/return what would be deleted without actually deleting. Useful
   * for the first run against a real account.
   */
  dryRun?: boolean
  /**
   * Per-queue diagnostics callback. Invoked once per scanned queue with the
   * decision (`'reap' | 'keep' | 'error'`) and reason.
   */
  onDecision?: (info: {
    queueUrl: string
    queueName: string
    decision: 'reap' | 'keep' | 'error'
    reason: string
    heartbeatAge?: number
  }) => void
}

export type ReapStaleQueuesResult = {
  /** Queue URLs that were deleted (or would be, in dry-run). */
  deleted: string[]
  /** Queue URLs that were considered but left alone (active heartbeat). */
  skipped: string[]
  /** Subscription ARNs that were unsubscribed (or would be, in dry-run). */
  unsubscribed: string[]
  /** Per-queue errors. The reaper continues past individual failures. */
  errors: Array<{ queueUrl?: string; error: Error }>
}

/**
 * Scan SQS for queues matching `queueNamePrefix` and delete any whose
 * heartbeat tag is older than `idleThresholdMs` (or that have no heartbeat
 * tag and were created longer than the threshold ago).
 *
 * When `snsClient` and `topicArn`/`topicArns` are supplied, also remove
 * SNS subscriptions whose endpoint ARN points at one of the deleted queues.
 *
 * This is the recommended cleanup mechanism for deployments where pod names
 * (and therefore queue names) are not stable across restarts. Schedule it as
 * a periodic job (cron, Lambda) using credentials with `sqs:ListQueues`,
 * `sqs:ListQueueTags`, `sqs:GetQueueAttributes`, `sqs:DeleteQueue`, and
 * optionally `sns:ListSubscriptionsByTopic` + `sns:Unsubscribe`.
 *
 * Idempotent: a queue that disappears between listing and deletion is treated
 * as success.
 */
export async function reapStaleQueues(
  params: ReapStaleQueuesParams,
): Promise<ReapStaleQueuesResult> {
  const idleThresholdMs = params.idleThresholdMs ?? DEFAULT_REAPER_IDLE_THRESHOLD_MS
  if (!Number.isFinite(idleThresholdMs) || idleThresholdMs <= 0) {
    throw new Error(
      `reapStaleQueues: idleThresholdMs must be a positive number (got ${idleThresholdMs})`,
    )
  }

  // Dedupe topics up front: callers commonly pass the same ARN via topicArn
  // *and* topicArns out of copy-paste convenience; we should not scan twice.
  const topicArns =
    params.snsClient !== undefined
      ? Array.from(
          new Set<string>([
            ...(params.topicArn ? [params.topicArn] : []),
            ...(params.topicArns ?? []),
          ]),
        )
      : []
  if (params.snsClient && topicArns.length === 0) {
    throw new Error(
      'reapStaleQueues: snsClient was supplied without topicArn / topicArns; the reaper would silently skip orphan-subscription cleanup. Pass at least one topic ARN, or omit snsClient if SNS cleanup is not desired.',
    )
  }

  const now = Date.now()
  const result: ReapStaleQueuesResult = {
    deleted: [],
    skipped: [],
    unsubscribed: [],
    errors: [],
  }

  // 1. List all candidate queues. SQS returns at most 1000 URLs per page; for
  // accounts with more we page via NextToken.
  const queueUrls: string[] = []
  let nextToken: string | undefined
  do {
    const listed = await params.sqsClient.send(
      new ListQueuesCommand({
        QueueNamePrefix: params.queueNamePrefix,
        MaxResults: 1000,
        NextToken: nextToken,
      }),
    )
    if (listed.QueueUrls) queueUrls.push(...listed.QueueUrls)
    nextToken = listed.NextToken
  } while (nextToken)

  // 2. For each candidate, fetch heartbeat tag + creation timestamp.
  const deletedQueueArns = new Set<string>()
  // Queues we reaped but for which we could not learn the ARN (e.g.
  // GetQueueAttributes throttled). The SNS cleanup step exposes this so the
  // caller knows orphan-subscription cleanup may be incomplete and can re-run.
  let reapedWithoutArn = 0
  for (const queueUrl of queueUrls) {
    const queueName = queueUrl.split('/').pop() ?? queueUrl
    // Fetch tags and attributes independently so a transient failure in one
    // does not eliminate the other's signal (and so a queue that disappears
    // mid-scan can be reported as 'keep' instead of 'error', per the
    // documented idempotency contract).
    const [tagsResult, attrsResult] = await Promise.allSettled([
      params.sqsClient.send(new ListQueueTagsCommand({ QueueUrl: queueUrl })),
      params.sqsClient.send(
        new GetQueueAttributesCommand({
          QueueUrl: queueUrl,
          AttributeNames: ['CreatedTimestamp', 'QueueArn'],
        }),
      ),
    ])

    // A queue that disappeared between ListQueues and the per-queue fetch is
    // not an error — treat it as already-reaped by someone else.
    if (
      (tagsResult.status === 'rejected' && isQueueNotFound(tagsResult.reason)) ||
      (attrsResult.status === 'rejected' && isQueueNotFound(attrsResult.reason))
    ) {
      params.onDecision?.({
        queueUrl,
        queueName,
        decision: 'keep',
        reason: 'queue disappeared between ListQueues and inspection',
      })
      continue
    }

    // Any other failure is recorded and we move to the next queue rather than
    // aborting the whole sweep.
    if (tagsResult.status === 'rejected') {
      const error = tagsResult.reason as Error
      params.onDecision?.({
        queueUrl,
        queueName,
        decision: 'error',
        reason: error.message,
      })
      result.errors.push({ queueUrl, error })
      continue
    }
    if (attrsResult.status === 'rejected') {
      const error = attrsResult.reason as Error
      params.onDecision?.({
        queueUrl,
        queueName,
        decision: 'error',
        reason: error.message,
      })
      result.errors.push({ queueUrl, error })
      continue
    }

    const tagsResp = tagsResult.value
    const attrsResp = attrsResult.value

    const heartbeatRaw = tagsResp.Tags?.[HEARTBEAT_TAG_KEY]
    // Require an explicit non-empty string AND a strictly positive parse —
    // values like '', '0', or 'abc' must NOT be treated as ancient
    // timestamps (which would always exceed any threshold and reap a live
    // queue).
    const heartbeatMs =
      typeof heartbeatRaw === 'string' && heartbeatRaw.length > 0
        ? Number.parseInt(heartbeatRaw, 10)
        : Number.NaN
    const heartbeatValid = Number.isFinite(heartbeatMs) && heartbeatMs > 0
    const createdSecRaw = attrsResp.Attributes?.CreatedTimestamp
    const createdMs = createdSecRaw ? Number.parseInt(createdSecRaw, 10) * 1000 : Number.NaN
    const queueArn = attrsResp.Attributes?.QueueArn

    let shouldReap = false
    let reason = ''
    let heartbeatAge: number | undefined

    if (heartbeatValid) {
      heartbeatAge = now - heartbeatMs
      if (heartbeatAge > idleThresholdMs) {
        shouldReap = true
        reason = `heartbeat ${heartbeatAge}ms old > ${idleThresholdMs}ms threshold`
      } else {
        reason = `heartbeat ${heartbeatAge}ms old <= ${idleThresholdMs}ms threshold`
      }
    } else if (Number.isFinite(createdMs)) {
      // No (usable) heartbeat tag: only reap if the queue is old enough that
      // a live consumer would have written at least one beat by now.
      const ageMs = now - createdMs
      if (ageMs > idleThresholdMs) {
        shouldReap = true
        reason = `no heartbeat tag, queue ${ageMs}ms old > ${idleThresholdMs}ms threshold`
      } else {
        reason = `no heartbeat tag, queue only ${ageMs}ms old`
      }
    } else {
      reason = 'no heartbeat tag and no creation timestamp; skipping conservatively'
    }

    if (shouldReap) {
      params.onDecision?.({ queueUrl, queueName, decision: 'reap', reason, heartbeatAge })
      if (!params.dryRun) {
        try {
          await params.sqsClient.send(new DeleteQueueCommand({ QueueUrl: queueUrl }))
        } catch (err) {
          // DeleteQueue is idempotent for our purposes: if the queue is
          // already gone, treat as success.
          if (!isQueueNotFound(err)) {
            const error = err as Error
            params.onDecision?.({
              queueUrl,
              queueName,
              decision: 'error',
              reason: error.message,
            })
            result.errors.push({ queueUrl, error })
            continue
          }
        }
      }
      result.deleted.push(queueUrl)
      if (queueArn) {
        deletedQueueArns.add(queueArn)
      } else {
        reapedWithoutArn += 1
      }
    } else {
      params.onDecision?.({ queueUrl, queueName, decision: 'keep', reason, heartbeatAge })
      result.skipped.push(queueUrl)
    }
  }

  // 3. Optional SNS subscription cleanup. We only know which subscriptions to
  // touch when we have the ARN of at least one deleted queue.
  if (params.snsClient && deletedQueueArns.size > 0) {
    for (const topicArn of topicArns) {
      try {
        let snsNext: string | undefined
        do {
          const subs = await params.snsClient.send(
            new ListSubscriptionsByTopicCommand({
              TopicArn: topicArn,
              NextToken: snsNext,
            }),
          )
          for (const sub of subs.Subscriptions ?? []) {
            if (
              sub.Protocol === 'sqs' &&
              sub.Endpoint &&
              sub.SubscriptionArn &&
              // PendingConfirmation entries can't be unsubscribed by ARN
              sub.SubscriptionArn !== PENDING_CONFIRMATION_ARN &&
              deletedQueueArns.has(sub.Endpoint)
            ) {
              if (!params.dryRun) {
                try {
                  await params.snsClient.send(
                    new UnsubscribeCommand({ SubscriptionArn: sub.SubscriptionArn }),
                  )
                } catch (err) {
                  if (!isSubscriptionNotFound(err)) throw err
                }
              }
              result.unsubscribed.push(sub.SubscriptionArn)
            }
          }
          snsNext = subs.NextToken
        } while (snsNext)
      } catch (err) {
        result.errors.push({ error: err as Error })
      }
    }
  }

  // If we deleted queues but never learned their ARNs, surface that as a
  // non-fatal error so the caller knows orphan-subscription cleanup may be
  // incomplete (rather than silently skipping it).
  if (params.snsClient && reapedWithoutArn > 0) {
    result.errors.push({
      error: new Error(
        `reapStaleQueues: ${reapedWithoutArn} queue(s) deleted without a known QueueArn (likely GetQueueAttributes returned no QueueArn); their SNS subscriptions could not be cleaned up. Re-run after retrying GetQueueAttributes, or clean them up via another mechanism.`,
      ),
    })
  }

  return result
}

/**
 * Resolves a queue URL by name. Convenience for callers building locator
 * configs or testing the lifecycle helpers.
 */
export async function resolveQueueUrl(
  sqsClient: SQSClient,
  queueName: string,
): Promise<string | undefined> {
  try {
    const resp = await sqsClient.send(new GetQueueUrlCommand({ QueueName: queueName }))
    return resp.QueueUrl
  } catch (err) {
    if (isQueueNotFound(err)) return undefined
    throw err
  }
}

/**
 * Returns true when the SDK error indicates the queue no longer exists.
 * Exported so consumer cleanup paths can apply the same idempotency the
 * reaper does.
 */
export function isQueueNotFound(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const name = (err as { name?: string }).name
  return (
    name === 'AWS.SimpleQueueService.NonExistentQueue' ||
    name === 'QueueDoesNotExist' ||
    name === 'NonExistentQueue'
  )
}

/**
 * Returns true when the SDK error indicates the SNS subscription no longer
 * exists (typical when the subscription has already been removed by another
 * actor — e.g. the reaper — or was never confirmed).
 */
export function isSubscriptionNotFound(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const name = (err as { name?: string }).name
  // SNS surfaces missing subscriptions as NotFound; some legacy paths return
  // InvalidParameter when the ARN is malformed (e.g. literal
  // "PendingConfirmation"). Both are non-actionable on shutdown.
  return name === 'NotFound' || name === 'NotFoundException'
}

/**
 * Literal value SNS returns for `SubscriptionArn` when the subscription has
 * not yet been confirmed by the endpoint. UnsubscribeCommand cannot accept it,
 * so callers must skip the call entirely.
 */
export const PENDING_CONFIRMATION_ARN = 'PendingConfirmation'
