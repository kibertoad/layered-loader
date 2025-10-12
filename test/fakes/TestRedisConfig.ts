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

export type ServerConfig = {
  name: string
  createClient: () => Promise<RedisClientType>
  closeClient: (client: RedisClientType) => Promise<void>
}

export const testServerConfigs: ServerConfig[] = [
  {
    name: 'Redis',
    createClient: async () => new Redis(redisOptions),
    closeClient: async (client: RedisClientType) => {
      if ('quit' in client && typeof client.quit === 'function') {
        await client.quit()
      }
    },
  },
  {
    name: 'Valkey',
    createClient: async () => {
      return await GlideClient.createClient(valkeyGlideConfig)
    },
    closeClient: async (client: RedisClientType) => {
      if (client && 'close' in client && typeof client.close === 'function') {
        await client.close()
      }
    },
  },
]
