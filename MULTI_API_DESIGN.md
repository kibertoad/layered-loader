# Multi/Batch API Design Decision

## Current Implementation

The current `multi()` signature accepts an array of commands and executes them atomically:

```typescript
interface RedisClientInterface {
  multi?(commands: any[][]): Promise<any>
}
```

### IoRedisClientAdapter
```typescript
async multi(commands: any[][]): Promise<any> {
  return this.client.multi(commands).exec()
}
```

### ValkeyGlideClientAdapter
```typescript
async multi(commands: any[][]): Promise<any> {
  const batch = new Batch(true)  // atomic
  // ...add commands to batch...
  return this.client.exec(batch, true)
}
```

## Potential Alternative: Fluent/Chainable API

A fluent API would look like:

```typescript
interface RedisClientInterface {
  multi?(): MultiPipeline
}

interface MultiPipeline {
  incr(key: string): this
  pexpire(key: string, ms: number): this
  set(key: string, value: string, mode?: string, ttl?: number): this
  exec(): Promise<any[]>
}
```

### Pros of Fluent API
- Matches ioredis native API more closely
- Allows incremental command building
- More flexible for complex scenarios

### Cons of Fluent API
- **Doesn't match valkey-glide's Batch API design**
  - Batch is built declaratively, not fluently
  - Would require creating a wrapper class for valkey-glide
- **Not needed for current use cases**
  - All our usage builds command arrays first
  - No need for incremental chaining in practice
- **More complex implementation**
  - Need to maintain wrapper class state
  - Need to handle differences between ioredis pipeline and Batch

## Current Usage Pattern

All current usage follows this pattern:

```typescript
// Build command array
const commands = [
  ['incr', key],
  ['pexpire', key, ttl],
]

// Execute atomically
await this.redis.multi(commands)
```

This pattern:
- ✅ Works identically for both clients
- ✅ Clear and explicit
- ✅ Easy to test
- ✅ No hidden state in wrapper objects

## Recommendation

**Keep the current array-based API** because:

1. **It works perfectly for our use cases** - We always build full command lists upfront
2. **It's simpler** - No need for wrapper classes or state management
3. **It's portable** - Works the same way for both ioredis and valkey-glide
4. **It's testable** - Easy to verify what commands will be executed
5. **It's explicit** - Caller sees all commands at once

## If Fluent API is Needed in Future

If we later need a fluent API, we can:

1. Keep `multi(commands[][])` for the declarative approach
2. Add `createPipeline()` or `createTransaction()` for fluent approach
3. Return wrapper class that implements MultiPipeline interface

This would allow both styles:

```typescript
// Declarative (current)
await redis.multi([['incr', key], ['pexpire', key, ttl]])

// Fluent (future if needed)
await redis.createTransaction()
  .incr(key)
  .pexpire(key, ttl)
  .exec()
```

## Conclusion

The current implementation is **correct and appropriate** for our needs. 

The array-based API:
- ✅ Matches our usage patterns
- ✅ Works consistently across both clients
- ✅ Is simple and maintainable
- ✅ Is easy to test and reason about

**No changes needed** to the multi() API at this time.
