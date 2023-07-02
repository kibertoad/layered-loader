const autocannonConfig = {
  url: 'http://localhost:3000',
  workers: 8,
  connections: 4000,
  pipelining: 10,
  duration: 5,
  warmup: {
    connections: 10,
    duration: 5,
  },
}

module.exports = {
  autocannonConfig,
}
