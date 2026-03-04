import { appConfig } from './config';

export type WsIncomingMessage = {
  type: string;
  payload?: unknown;
};

export function createAgentSocket(options: {
  projectId?: string;
  onMessage?: (message: WsIncomingMessage) => void;
  onOpen?: () => void;
  onClose?: () => void;
}) {
  let socket: WebSocket | null = null;

  try {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const search = options.projectId
      ? `?projectId=${encodeURIComponent(options.projectId)}`
      : '';
    const url = `${protocol}//${window.location.host}${appConfig.wsPath}${search}`;
    socket = new WebSocket(url);

    socket.addEventListener('open', () => options.onOpen?.());
    socket.addEventListener('close', () => options.onClose?.());
    socket.addEventListener('message', (event) => {
      try {
        const parsed = JSON.parse(event.data) as WsIncomingMessage;
        options.onMessage?.(parsed);
      } catch {
        options.onMessage?.({
          type: 'client.parse_error',
          payload: event.data,
        });
      }
    });
  } catch {
    options.onClose?.();
  }

  return {
    socket,
    send: (message: unknown) => {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }

      socket.send(JSON.stringify(message));
    },
    close: () => {
      if (!socket) {
        return;
      }

      socket.close();
    },
  };
}
