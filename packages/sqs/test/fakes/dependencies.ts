import { globalLogger } from '@lokalise/node-core'
import {
  NoopObservabilityManager,
  type ErrorReporter,
  type TransactionObservabilityManager,
} from '@lokalise/node-core'
import {
  type SNSDependencies,
  SnsConsumerErrorResolver,
} from '@message-queue-toolkit/sns'
import type { SNSSQSConsumerDependencies } from '@message-queue-toolkit/sns'
import type { AwsClientBundle } from './awsClients.js'

const noopErrorReporter: ErrorReporter = {
  report: () => {
    /* noop */
  },
}

export function buildPublisherDeps(clients: AwsClientBundle): SNSDependencies {
  return {
    snsClient: clients.snsClient,
    stsClient: clients.stsClient,
    logger: globalLogger,
    errorReporter: noopErrorReporter,
  }
}

export function buildConsumerDeps(clients: AwsClientBundle): SNSSQSConsumerDependencies {
  const observability: TransactionObservabilityManager = new NoopObservabilityManager()

  return {
    sqsClient: clients.sqsClient,
    snsClient: clients.snsClient,
    stsClient: clients.stsClient,
    logger: globalLogger,
    errorReporter: noopErrorReporter,
    consumerErrorResolver: new SnsConsumerErrorResolver(),
    transactionObservabilityManager: observability,
  }
}
