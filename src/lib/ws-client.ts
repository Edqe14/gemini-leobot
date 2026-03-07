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
  onError?: (message: string) => void;
  onCloseDetail?: (detail: { code: number; reason: string }) => void;
}) {
  let socket: WebSocket | null = null;
  let shouldReconnect = true;
  let reconnectTimer: number | null = null;
  let reconnectAttempts = 0;

  const RECONNECT_INITIAL_DELAY_MS = 250;
  const RECONNECT_MAX_DELAY_MS = 2000;

  const scheduleReconnect = () => {
    const delay = Math.min(
      RECONNECT_INITIAL_DELAY_MS * 2 ** reconnectAttempts,
      RECONNECT_MAX_DELAY_MS,
    );
    reconnectAttempts += 1;

    reconnectTimer = window.setTimeout(() => {
      connect();
    }, delay);
  };

  const connect = () => {
    if (!shouldReconnect) {
      return;
    }

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const search = options.projectId
        ? `?projectId=${encodeURIComponent(options.projectId)}`
        : '';
      const url = `${protocol}//${window.location.host}${appConfig.wsPath}${search}`;
      socket = new WebSocket(url);

      socket.addEventListener('open', () => {
        reconnectAttempts = 0;
        options.onOpen?.();
      });

      socket.addEventListener('error', () => {
        options.onError?.('WebSocket network error');
      });

      socket.addEventListener('close', (event) => {
        options.onClose?.();
        options.onCloseDetail?.({ code: event.code, reason: event.reason });

        if (!shouldReconnect) {
          return;
        }

        scheduleReconnect();
      });

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
      scheduleReconnect();
    }
  };

  connect();

  return {
    socket,
    send: (message: unknown) => {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }

      socket.send(JSON.stringify(message));
    },
    close: () => {
      shouldReconnect = false;
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      if (!socket) {
        return;
      }

      socket.close();
    },
  };
}
