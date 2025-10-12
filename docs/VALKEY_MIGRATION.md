# Migrating from ioredis to @valkey/valkey-glide

This guide helps you migrate your layered-loader setup from ioredis to @valkey/valkey-glide.

## Why Valkey-Glide?

- **Modern architecture:** Built specifically for Valkey (Redis fork)
- **Performance:** Optimized Rust core with Node.js bindings
- **Active development:** Official Valkey client with ongoing support
- **Full compatibility:** Works seamlessly with layered-loader

## Quick Start

### 1. Install Dependencies

```bash
npm install @valkey/valkey-glide
# Keep ioredis for now if you want gradual migration
```

### 2. Update Your Code

#### Before (ioredis)

```typescript
import Redis from 'ioredis'
import { RedisCache } from 'layered-loader'

const redis = new Redis({
  host: 'localhost',
  port: 6379,
  password: 'your-password',
})

const cache = new RedisCache<string>(redis, {
  prefix: 'user:',
  ttlInMsecs: 60000,
})
```

#### After (valkey-glide)

```typescript
import { GlideClient } from '@valkey/valkey-glide'
import { RedisCache } from 'layered-loader'

const redis = await GlideClient.createClient({
  addresses: [{ host: 'localhost', port: 6379 }],
  credentials: { password: 'your-password' },
})

const cache = new RedisCache<string>(redis, {
  prefix: 'user:',
  ttlInMsecs: 60000,
})
```

**Key differences:**
- ✅ `createClient()` is **async** - use `await`
- ✅ `addresses` is an **array** - supports cluster mode
- ✅ `credentials` is an **object** - structured config

## Complete Examples

### Basic Cache

```typescript
import { GlideClient } from '@valkey/valkey-glide'
import { RedisCache, Loader } from 'layered-loader'

// Create Valkey client
const valkeyClient = await GlideClient.createClient({
  addresses: [{ host: 'localhost', port: 6379 }],
  clientName: 'my-app',
  requestTimeout: 2000,
  credentials: {
    password: 'your-password',
  },
})

// Create loader with Valkey cache
const userLoader = new Loader<User>({
  inMemoryCache: { ttlInMsecs: 30000 },
  asyncCache: new RedisCache<User>(valkeyClient, {
    prefix: 'user:',
    ttlInMsecs: 300000,
    jsonSerialization: true,
  }),
  dataSources: [
    {
      id: 'database',
      get: async (id: string) => {
        return database.users.findById(id)
      },
    },
  ],
})

// Use it!
const user = await userLoader.get('user-123')
```

### Pub/Sub Notifications

**Important:** Valkey-glide requires subscriptions at client creation time!

```typescript
import { GlideClient } from '@valkey/valkey-glide'
import { createNotificationPair } from 'layered-loader'

const CHANNEL = 'cache-invalidation'

// Option 1: Pass existing clients (subscription must already be configured)
const publisher = await GlideClient.createClient({
  addresses: [{ host: 'localhost', port: 6379 }],
})

const consumer = await GlideClient.createClient({
  addresses: [{ host: 'localhost', port: 6379 }],
  pubsubSubscriptions: {
    channelsAndPatterns: {
      0: new Set([CHANNEL]),  // 0 = Exact mode
    },
  },
})

const { publisher: notifPub, consumer: notifCon } = await createNotificationPair({
  channel: CHANNEL,
  publisherRedis: publisher,
  consumerRedis: consumer,
})

// Option 2: Pass config objects (layered-loader creates clients)
const { publisher: notifPub, consumer: notifCon } = await createNotificationPair({
  channel: CHANNEL,
  publisherRedis: {
    addresses: [{ host: 'localhost', port: 6379 }],
  },
  consumerRedis: {
    addresses: [{ host: 'localhost', port: 6379 }],
    pubsubSubscriptions: {
      channelsAndPatterns: {
        0: new Set([CHANNEL]),
      },
    },
  },
})

// Use with loader
const loader = new Loader<User>({
  inMemoryCache: { ttlInMsecs: 30000 },
  asyncCache: new RedisCache<User>(valkeyClient, { prefix: 'user:' }),
  notificationPublisher: notifPub,
  notificationConsumer: notifCon,
  dataSources: [/* ... */],
})
```

### Group Cache

```typescript
import { GlideClient } from '@valkey/valkey-glide'
import { RedisGroupCache, GroupLoader } from 'layered-loader'

const valkeyClient = await GlideClient.createClient({
  addresses: [{ host: 'localhost', port: 6379 }],
})

const groupLoader = new GroupLoader<Post>({
  inMemoryCache: {
    cacheId: 'posts-by-user',
    ttlInMsecs: 60000,
    maxGroups: 1000,
    maxItemsPerGroup: 100,
  },
  asyncCache: new RedisGroupCache<Post>(valkeyClient, {
    prefix: 'post:',
    groupPrefix: 'user:',
    ttlInMsecs: 300000,
    jsonSerialization: true,
  }),
  dataSources: [
    {
      id: 'database',
      getFromGroup: async (postId: string, userId: string) => {
        return database.posts.findOne({ id: postId, userId })
      },
    },
  ],
})

// Fetch user's posts
const post = await groupLoader.getFromGroup('post-123', 'user-456')
```

## Configuration Mapping

### Connection Options

| ioredis | valkey-glide | Notes |
|---------|--------------|-------|
| `host`, `port` | `addresses: [{ host, port }]` | valkey-glide uses array for cluster support |
| `password` | `credentials: { password }` | Structured credentials object |
| `db` | ❌ Not supported | Use different client instances |
| `family` | `addresses: [..., addressType]` | IPv4/IPv6 via addressType |
| `connectTimeout` | `requestTimeout` | Timeout for all operations |
| `keepAlive` | ✅ Always enabled | Built-in connection pooling |
| `retryStrategy` | ❌ Not directly supported | Use connection config |

### Pub/Sub Differences

**ioredis (Dynamic):**
```typescript
const redis = new Redis()
await redis.subscribe('my-channel')
redis.on('message', (channel, message) => {
  console.log(channel, message)
})
```

**valkey-glide (Static):**
```typescript
const redis = await GlideClient.createClient({
  pubsubSubscriptions: {
    channelsAndPatterns: {
      0: new Set(['my-channel']),  // Exact match
      1: new Set(['events:*']),    // Pattern match
    },
    callback: (msg) => {
      console.log(msg.channel, msg.message)
    },
  },
})
```

**In layered-loader:** The adapter handles this difference transparently!

## Migration Strategies

### Strategy 1: Gradual Migration (Recommended)

1. **Week 1:** Add valkey-glide to dev/staging
2. **Week 2-3:** Test thoroughly, monitor performance
3. **Week 4:** Deploy to production (canary rollout)
4. **Month 2-3:** Monitor, gather feedback
5. **Month 6:** Remove ioredis if all is well

### Strategy 2: Side-by-Side

Run both clients simultaneously:

```typescript
import Redis from 'ioredis'
import { GlideClient } from '@valkey/valkey-glide'

const ioredisClient = new Redis({ /* ... */ })
const valkeyClient = await GlideClient.createClient({ /* ... */ })

// Use valkey for new features
const newCache = new RedisCache(valkeyClient, { /* ... */ })

// Keep ioredis for existing features
const legacyCache = new RedisCache(ioredisClient, { /* ... */ })
```

### Strategy 3: Feature Flags

```typescript
const USE_VALKEY = process.env.USE_VALKEY === 'true'

const redisClient = USE_VALKEY
  ? await GlideClient.createClient({ /* ... */ })
  : new Redis({ /* ... */ })

const cache = new RedisCache(redisClient, { /* ... */ })
```

## Troubleshooting

### Issue: "PubSubMsg channel is undefined"

**Problem:** Accessing context.channel instead of msg.channel

**Solution:** Update callback to use msg.channel
```typescript
// Wrong
callback: (msg, context) => {
  const channel = context.channel  // ❌ undefined
}

// Correct
callback: (msg) => {
  const channel = msg.channel  // ✅ works
}
```

### Issue: "Connection timeout"

**Problem:** requestTimeout too low

**Solution:** Increase timeout
```typescript
const client = await GlideClient.createClient({
  requestTimeout: 5000,  // 5 seconds
  // ...
})
```

### Issue: "Client already subscribed"

**Problem:** Trying to subscribe after client creation

**Solution:** Configure subscriptions at creation:
```typescript
// ❌ Wrong
const client = await GlideClient.createClient({})
await client.subscribe('channel')  // Not supported!

// ✅ Correct
const client = await GlideClient.createClient({
  pubsubSubscriptions: {
    channelsAndPatterns: { 0: new Set(['channel']) },
  },
})
```

## Performance Tips

1. **Connection Pooling:** valkey-glide manages this automatically
2. **Request Timeout:** Tune based on your latency requirements
3. **Client Reuse:** Create one client, reuse across caches
4. **Cluster Mode:** Use addresses array for Redis Cluster

```typescript
// Single instance
const client = await GlideClient.createClient({
  addresses: [{ host: 'localhost', port: 6379 }],
})

// Cluster
const client = await GlideClient.createClient({
  addresses: [
    { host: 'node1.redis.com', port: 6379 },
    { host: 'node2.redis.com', port: 6379 },
    { host: 'node3.redis.com', port: 6379 },
  ],
})

// Reuse for all caches
const userCache = new RedisCache<User>(client, { prefix: 'user:' })
const postCache = new RedisCache<Post>(client, { prefix: 'post:' })
```

## Testing

Both clients work identically in layered-loader:

```typescript
import { describe, it, expect } from 'vitest'

describe('Cache Tests', () => {
  it('works with valkey-glide', async () => {
    const client = await GlideClient.createClient({ /* ... */ })
    const cache = new RedisCache<string>(client, { prefix: 'test:' })
    
    await cache.set('key', 'value')
    const result = await cache.get('key')
    
    expect(result).toBe('value')
    await client.close()
  })
})
```

## FAQ

**Q: Do I need to change my application code?**  
A: No! layered-loader's adapter handles all differences.

**Q: Is there a performance difference?**  
A: Valkey-glide is generally faster due to Rust core. Micro-benchmarks show 5-15% improvement.

**Q: Can I use both clients simultaneously?**  
A: Yes! They can coexist in the same application.

**Q: What about Redis Cluster?**  
A: valkey-glide has native cluster support via addresses array.

**Q: Should I migrate now?**  
A: If you're on Valkey (not Redis), yes. If on Redis, you can wait or migrate gradually.

## Support

- **Valkey-glide docs:** https://github.com/valkey-io/valkey-glide
- **layered-loader issues:** https://github.com/kibertoad/layered-loader/issues
- **Valkey community:** https://valkey.io/community/

## Next Steps

1. ✅ Install @valkey/valkey-glide
2. ✅ Update one cache to use valkey-glide
3. ✅ Test thoroughly
4. ✅ Monitor performance
5. ✅ Gradually migrate remaining caches
6. ✅ Remove ioredis when confident

Happy caching! 🚀
