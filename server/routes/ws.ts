import { createNodeWebSocket } from '@hono/node-ws'
import type { Hono } from 'hono'
import type { WSContext } from 'hono/ws'
import { getSessionFromHeaders } from '../lib/auth'
import { connectGeminiLiveBridge } from '../lib/gemini'

type ClientMessage =
  | { type: 'gemini.clientContent'; payload: { turns?: unknown[]; turnComplete?: boolean } }
  | { type: 'gemini.realtimeInput'; payload: { media: { mimeType: string; data: string } } }
  | { type: 'agent.context'; payload: { projectId?: string } }

export function registerWs(app: Hono) {
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

  app.get(
    '/ws',
    upgradeWebSocket(async (c) => {
      const session = await getSessionFromHeaders(c.req.raw.headers)
      if (!session) {
        return {
          onOpen(_event, ws) {
            ws.send(JSON.stringify({ type: 'error', payload: 'Unauthorized websocket session' }))
            ws.close(1008, 'Unauthorized')
          },
        }
      }

      let projectId = c.req.query('projectId')
      let geminiBridge: Awaited<ReturnType<typeof connectGeminiLiveBridge>> | null = null

      return {
        async onOpen(_event, ws) {
          geminiBridge = await connectGeminiLiveBridge({
            ws,
            userId: session.user.id,
            projectId,
          })

          ws.send(JSON.stringify({ type: 'ws.ready' }))
        },
        onMessage(event, ws) {
          if (!geminiBridge?.session) {
            ws.send(JSON.stringify({ type: 'error', payload: 'Gemini session not ready' }))
            return
          }

          const msg = safeParseMessage(event.data)
          if (!msg) {
            ws.send(JSON.stringify({ type: 'error', payload: 'Invalid websocket payload' }))
            return
          }

          if (msg.type === 'agent.context') {
            projectId = msg.payload.projectId
            ws.send(JSON.stringify({ type: 'agent.context.updated', payload: { projectId } }))
            return
          }

          if (msg.type === 'gemini.clientContent') {
            geminiBridge.session.sendClientContent({
              turns: msg.payload.turns as never,
              turnComplete: msg.payload.turnComplete,
            })
            return
          }

          geminiBridge.session.sendRealtimeInput({
            media: {
              mimeType: msg.payload.media.mimeType,
              data: msg.payload.media.data,
            },
          })
        },
        onClose() {
          geminiBridge?.close()
        },
      }
    }),
  )

  return { injectWebSocket }
}

function safeParseMessage(input: string | ArrayBuffer): ClientMessage | null {
  try {
    const raw = typeof input === 'string' ? input : Buffer.from(input).toString('utf-8')
    const parsed = JSON.parse(raw) as ClientMessage
    return parsed
  } catch {
    return null
  }
}
