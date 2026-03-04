import { appConfig } from './config'

export type WsIncomingMessage = {
  type: string
  payload?: unknown
}

export function createAgentSocket(options: {
  projectId?: string
  onMessage?: (message: WsIncomingMessage) => void
  onOpen?: () => void
  onClose?: () => void
}) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const search = options.projectId ? `?projectId=${encodeURIComponent(options.projectId)}` : ''
  const url = `${protocol}//${window.location.host}${appConfig.wsPath}${search}`
  const socket = new WebSocket(url)

  socket.addEventListener('open', () => options.onOpen?.())
  socket.addEventListener('close', () => options.onClose?.())
  socket.addEventListener('message', (event) => {
    try {
      const parsed = JSON.parse(event.data) as WsIncomingMessage
      options.onMessage?.(parsed)
    } catch {
      options.onMessage?.({ type: 'client.parse_error', payload: event.data })
    }
  })

  return {
    socket,
    send: (message: unknown) => socket.send(JSON.stringify(message)),
    close: () => socket.close(),
  }
}
