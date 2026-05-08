import { type FauxqsServer, startFauxqs } from 'fauxqs'

let server: FauxqsServer | undefined

export async function setup() {
  server = await startFauxqs({ port: 0, logger: false })
  process.env.FAUXQS_ENDPOINT = server.address
}

export async function teardown() {
  await server?.stop()
}
