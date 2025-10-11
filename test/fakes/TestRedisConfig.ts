import type { RedisOptions } from 'ioredis'

export const redisOptions: RedisOptions = {
  host: 'localhost',
  port: 6379,
  password: 'sOmE_sEcUrE_pAsS',
}

export const valkeyOptions: RedisOptions = {
  host: 'localhost',
  port: 6380,
  password: 'sOmE_sEcUrE_pAsS',
}

export type ServerConfig = {
  name: string
  options: RedisOptions
}

export const testServerConfigs: ServerConfig[] = [
  { name: 'Redis', options: redisOptions },
  { name: 'Valkey', options: valkeyOptions },
]
