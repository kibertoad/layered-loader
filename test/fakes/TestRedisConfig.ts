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
      // Try to close connections, but ignore errors (connection might already be closed)
      try {
        if ('quit' in pair.publisher && typeof pair.publisher.quit === 'function') {
          await pair.publisher.quit()
        }
      } catch {
        // Ignore - connection might already be closed
      }
      try {
        if ('quit' in pair.consumer && typeof pair.consumer.quit === 'function') {
          await pair.consumer.quit()
        }
      } catch {
        // Ignore - connection might already be closed
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
      // For valkey-glide, we need to create a message router
      // This will be stored on the client and invoked by the adapter
      // We use an array of callbacks to support multiple consumers on the same channel
      const messageRouter = new Map<string, Array<(channel: string, message: string) => void>>()

      // Helper to convert GlideString to string
      const convertToString = (value: any): string => {
        if (typeof value === 'string') return value
        if (Buffer.isBuffer(value)) return value.toString('utf8')
        return String(value)
      }

      // Helper to dispatch message to all callbacks
      const dispatchMessage = (channelName: string, message: string) => {
        const channelCallbacks = messageRouter.get(channelName)
        if (channelCallbacks) {
          for (const callback of channelCallbacks) {
            callback(channelName, message)
          }
        }
        const globalCallbacks = messageRouter.get('__global__')
        if (globalCallbacks) {
          for (const callback of globalCallbacks) {
            callback(channelName, message)
          }
        }
      }

      const consumerConfig: GlideClientConfiguration = {
        addresses: valkeyGlideConfig.addresses,
        clientName: valkeyGlideConfig.clientName,
        requestTimeout: valkeyGlideConfig.requestTimeout,
        credentials: valkeyGlideConfig.credentials,
        pubsubSubscriptions: {
          channelsAndPatterns: {
            // 0 = Exact, 1 = Pattern (from GlideClientConfiguration.PubSubChannelModes)
            0: new Set([channel]),
          },
          callback: (msg) => {
            // msg is a PubSubMsg with { message, channel, pattern? }
            const channelName = convertToString(msg.channel)
            const message = convertToString(msg.message)
            dispatchMessage(channelName, message)
          },
        },
      }

      const consumer = await GlideClient.createClient(consumerConfig)
      // Store the router on the client so the adapter can access it
      ;(consumer as any).__messageRouter = messageRouter

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
