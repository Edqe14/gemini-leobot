import { serve } from '@hono/node-server'
import { createApp } from './app'
import { registerWs } from './routes/ws'
import { env } from './lib/env'

const app = createApp()
const { injectWebSocket } = registerWs(app)

const server = serve({
  fetch: app.fetch,
  port: env.PORT,
})

injectWebSocket(server)

console.log(`API + WS server running on http://localhost:${env.PORT}`)
