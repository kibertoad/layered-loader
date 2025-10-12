import { GlideClient, type GlideClientConfiguration } from '@valkey/valkey-glide'
import type { RedisOptions } from 'ioredis'
import Redis from 'ioredis'
import type { RedisClientType } from '../../lib/redis/RedisClientAdapter'

export const redisOptions: RedisOptions = {
  host: 'localhost',
  port: 6379,
  password: 'sOmE_sEcUrE_pAsS',
}

export const valkeyGlideConfig: GlideClientConfiguration = {
  addresses: [{ host: 'localhost', port: 6380 }],
  clientName: 'test-client',
  requestTimeout: 2000,
  credentials: {
    password: 'sOmE_sEcUrE_pAsS',
  },
}

export type PubSubPair = {
  publisher: RedisClientType
  consumer: RedisClientType
}

export type ServerConfig = {
  name: string
  options: RedisOptions | GlideClientConfiguration
  createClient: () => Promise<RedisClientType>
  closeClient: (client: RedisClientType) => Promise<void>
  createPubSubPair: (channel: string) => Promise<PubSubPair>
  closePubSubPair: (pair: PubSubPair) => Promise<void>
}

export const testServerConfigs: ServerConfig[] = [
  {
    name: 'Redis',
    options: redisOptions,
    createClient: async () => new Redis(redisOptions),
    closeClient: async (client: RedisClientType) => {
      if ('quit' in client && typeof client.quit === 'function') {
        await client.quit()
      }
    },
    createPubSubPair: (_channel: string) => {
      // For ioredis, create regular clients - subscriptions are dynamic
      return Promise.resolve({
        publisher: new Redis(redisOptions),
        consumer: new Redis(redisOptions),
      })
    },
    closePubSubPair: async (pair: PubSubPair) => {
      if ('quit' in pair.publisher && typeof pair.publisher.quit === 'function') {
        await pair.publisher.quit()
      }
      if ('quit' in pair.consumer && typeof pair.consumer.quit === 'function') {
        await pair.consumer.quit()
      }
    },
  },
  {
    name: 'Valkey',
    options: valkeyGlideConfig,
    createClient: async () => {
      return await GlideClient.createClient(valkeyGlideConfig)
    },
    closeClient: async (client: RedisClientType) => {
      if (client && 'close' in client && typeof client.close === 'function') {
        await client.close()
      }
    },
    createPubSubPair: async (channel: string) => {
      // For valkey-glide, configure pub/sub at creation time
      const consumerConfig: GlideClientConfiguration = {
        ...valkeyGlideConfig,
        pubsubSubscriptions: {
          channelsAndPatterns: {
            channels: [{ type: 'Exact', value: channel }],
            patterns: [],
          },
        },
      }
      const consumer = await GlideClient.createClient(consumerConfig)
      const publisher = await GlideClient.createClient(valkeyGlideConfig)
      return { publisher, consumer }
    },
    closePubSubPair: async (pair: PubSubPair) => {
      if (
        pair.publisher &&
        'close' in pair.publisher &&
        typeof pair.publisher.close === 'function'
      ) {
        await pair.publisher.close()
      }
      if (pair.consumer && 'close' in pair.consumer && typeof pair.consumer.close === 'function') {
        await pair.consumer.close()
      }
    },
  },
]
