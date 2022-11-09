export class RedisTimeoutError extends Error {
  constructor(message = 'Redis timeout') {
    super(message)
    this.name = 'RedisTimeoutError'
  }
}
