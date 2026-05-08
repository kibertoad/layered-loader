import { type FauxqsServer, startFauxqs } from 'fauxqs'

/**
 * Global setup for the @layered-loader/sqs test suite.
 *
 * Runs an in-process fauxqs server on a random port and exports its address
 * via `process.env.FAUXQS_ENDPOINT`. In-process fauxqs is preferred over
 * docker for CI: no daemon required, sub-second startup, fully isolated per
 * test process. The docker-compose.yml at the repository root still provides
 * a fauxqs service for *local app smoke testing* against a fixed endpoint.
 *
 * Allowing `FAUXQS_ENDPOINT` to be supplied externally lets contributors run
 * the suite against their own server (e.g. a docker-compose-managed one) by
 * exporting the variable before invoking vitest.
 */

let server: FauxqsServer | undefined

export async function setup() {
  if (process.env.FAUXQS_ENDPOINT) return
  server = await startFauxqs({ port: 0, logger: false })
  process.env.FAUXQS_ENDPOINT = server.address
}

export async function teardown() {
  const currentServer = server
  server = undefined
  delete process.env.FAUXQS_ENDPOINT
  if (currentServer) {
    await currentServer.stop()
  }
}
