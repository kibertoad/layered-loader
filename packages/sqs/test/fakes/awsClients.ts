import { SNSClient } from '@aws-sdk/client-sns'
import { SQSClient } from '@aws-sdk/client-sqs'
import { STSClient } from '@aws-sdk/client-sts'

export type AwsClientBundle = {
  endpoint: string
  snsClient: SNSClient
  sqsClient: SQSClient
  stsClient: STSClient
  destroy: () => void
}

export function buildAwsClients(endpoint: string): AwsClientBundle {
  const credentials = { accessKeyId: 'test', secretAccessKey: 'test' }
  const region = 'us-east-1'

  const snsClient = new SNSClient({ endpoint, region, credentials })
  const sqsClient = new SQSClient({ endpoint, region, credentials })
  const stsClient = new STSClient({ endpoint, region, credentials })

  return {
    endpoint,
    snsClient,
    sqsClient,
    stsClient,
    destroy: () => {
      snsClient.destroy()
      sqsClient.destroy()
      stsClient.destroy()
    },
  }
}
