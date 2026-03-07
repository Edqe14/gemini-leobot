import { createNodeWebSocket } from '@hono/node-ws';
import type { Hono } from 'hono';
import type { WSContext } from 'hono/ws';
import { getSessionFromHeaders } from '../lib/auth';
import { env } from '../lib/env';
import { connectGeminiLiveBridge } from '../lib/gemini';
import {
  closeDebugSession,
  createDebugSession,
  recordActionReceived,
  recordActionSent,
  recordUnauthorizedConnection,
  updateDebugSession,
} from '../lib/debug-monitor';

type ClientMessage =
  | {
      type: 'gemini.clientContent';
      payload: { turns?: unknown[]; turnComplete?: boolean };
    }
  | {
      type: 'gemini.realtimeInput';
      payload: { media: { mimeType: string; data: string } };
    }
  | { type: 'gemini.realtimeEnd'; payload?: { reason?: string } }
  | {
      type: 'agent.context';
      payload: {
        projectId?: string;
        projectName?: string;
        activeSubAgents?: string[];
        purpose?: string;
      };
    };

type RealtimeAudioChunk = {
  media: {
    mimeType: string;
    data: string;
  };
  receivedAt: number;
};

type PendingClientContent = {
  turns?: unknown[];
  turnComplete?: boolean;
  receivedAt: number;
};

const MAX_AUDIO_QUEUE_SIZE = 240;
const MAX_CLIENT_CONTENT_QUEUE_SIZE = 24;

function normalizeAgentName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '_');
}

function sanitizeActiveSubAgents(input?: string[]) {
  if (!Array.isArray(input)) {
    return [] as string[];
  }

  const unique = new Set<string>();
  for (const value of input) {
    if (typeof value !== 'string') {
      continue;
    }

    const normalized = normalizeAgentName(value);
    if (!normalized) {
      continue;
    }

    unique.add(normalized);
    if (unique.size >= 8) {
      break;
    }
  }

  return [...unique];
}

function createAgentContextKey(input: {
  projectId?: string;
  activeSubAgents?: string[];
  purpose?: string;
}) {
  return JSON.stringify({
    projectId: input.projectId?.trim() || null,
    activeSubAgents: sanitizeActiveSubAgents(input.activeSubAgents),
    purpose: input.purpose?.trim() || null,
  });
}

export function registerWs(app: Hono) {
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

  app.get(
    '/ws',
    upgradeWebSocket(async (c) => {
      const session = await getSessionFromHeaders(c.req.raw.headers);
      if (!session) {
        recordUnauthorizedConnection({
          route: '/ws',
          projectId: c.req.query('projectId'),
        });

        return {
          onOpen(_event, ws) {
            ws.send(
              JSON.stringify({
                type: 'error',
                payload: 'Unauthorized websocket session',
              }),
            );
            ws.close(1008, 'Unauthorized');
          },
        };
      }

      let projectId = c.req.query('projectId');
      let projectName: string | undefined;
      let activeSubAgents: string[] = [];
      let purpose: string | undefined;
      let agentContextKey = createAgentContextKey({ projectId });
      let geminiBridge: Awaited<
        ReturnType<typeof connectGeminiLiveBridge>
      > | null = null;
      let debugSessionId = '';
      const realtimeQueue: RealtimeAudioChunk[] = [];
      const clientContentQueue: PendingClientContent[] = [];
      let drainingQueue = false;
      let drainingClientContentQueue = false;
      let ingestedAudioChunks = 0;
      let forwardedAudioChunks = 0;

      const shouldRecordAudioChunkEvent = (count: number) =>
        count <= 3 || count % env.WS_AUDIO_CHUNK_LOG_EVERY === 0;

      const enqueueRealtimeChunk = (
        chunk: RealtimeAudioChunk,
        ws: WSContext<WebSocket>,
      ) => {
        if (realtimeQueue.length >= MAX_AUDIO_QUEUE_SIZE) {
          realtimeQueue.shift();
          recordActionSent(debugSessionId, 'gemini.realtimeInput.queue_drop', {
            maxSize: MAX_AUDIO_QUEUE_SIZE,
          });
        }

        realtimeQueue.push(chunk);
        ingestedAudioChunks += 1;
        if (shouldRecordAudioChunkEvent(ingestedAudioChunks)) {
          recordActionSent(debugSessionId, 'gemini.realtimeInput.queued', {
            queueSize: realtimeQueue.length,
            mimeType: chunk.media.mimeType,
            dataLength: chunk.media.data.length,
            ingestedAudioChunks,
          });
        }

        if (ingestedAudioChunks % 5 === 0) {
          ws.send(
            JSON.stringify({
              type: 'ws.audio.ingested',
              payload: {
                ingestedChunks: ingestedAudioChunks,
                queueSize: realtimeQueue.length,
              },
            }),
          );
        }
      };

      const drainRealtimeQueue = async (ws: WSContext<WebSocket>) => {
        if (drainingQueue || !geminiBridge?.session) {
          return;
        }

        drainingQueue = true;

        try {
          while (realtimeQueue.length > 0 && geminiBridge?.session) {
            const chunk = realtimeQueue.shift();
            if (!chunk) {
              continue;
            }

            const maybePromise = geminiBridge.session.sendRealtimeInput({
              audio: {
                mimeType: chunk.media.mimeType,
                data: chunk.media.data,
              },
            });
            const latencyMs = Date.now() - chunk.receivedAt;

            forwardedAudioChunks += 1;
            if (shouldRecordAudioChunkEvent(forwardedAudioChunks)) {
              recordActionSent(
                debugSessionId,
                'gemini.realtimeInput.forwarded',
                {
                  queueSize: realtimeQueue.length,
                  mimeType: chunk.media.mimeType,
                  dataLength: chunk.media.data.length,
                  latencyMs,
                  forwardedAudioChunks,
                },
              );
            }

            if (
              maybePromise &&
              typeof maybePromise === 'object' &&
              'then' in maybePromise &&
              typeof maybePromise.then === 'function'
            ) {
              void (maybePromise as Promise<unknown>).catch((error) => {
                const message =
                  error instanceof Error ? error.message : String(error);
                recordActionSent(debugSessionId, 'gemini.realtimeInput.error', {
                  message,
                  queueSize: realtimeQueue.length,
                });
              });
            }
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          ws.send(
            JSON.stringify({
              type: 'error',
              payload: 'Failed to forward realtime audio chunk',
            }),
          );
          recordActionSent(debugSessionId, 'gemini.realtimeInput.error', {
            message,
            queueSize: realtimeQueue.length,
          });
        } finally {
          drainingQueue = false;
        }
      };

      const enqueueClientContent = (payload: {
        turns?: unknown[];
        turnComplete?: boolean;
      }) => {
        if (clientContentQueue.length >= MAX_CLIENT_CONTENT_QUEUE_SIZE) {
          clientContentQueue.shift();
          recordActionSent(debugSessionId, 'gemini.clientContent.queue_drop', {
            maxSize: MAX_CLIENT_CONTENT_QUEUE_SIZE,
          });
        }

        clientContentQueue.push({
          turns: payload.turns,
          turnComplete: payload.turnComplete,
          receivedAt: Date.now(),
        });

        recordActionSent(debugSessionId, 'gemini.clientContent.queued', {
          queueSize: clientContentQueue.length,
          turnCount: payload.turns?.length ?? 0,
          turnComplete: payload.turnComplete,
        });
      };

      const drainClientContentQueue = async () => {
        if (drainingClientContentQueue || !geminiBridge?.session) {
          return;
        }

        drainingClientContentQueue = true;

        try {
          while (clientContentQueue.length > 0 && geminiBridge?.session) {
            const payload = clientContentQueue.shift();
            if (!payload) {
              continue;
            }

            geminiBridge.session.sendClientContent({
              turns: payload.turns as never,
              turnComplete: payload.turnComplete,
            });

            recordActionSent(debugSessionId, 'gemini.clientContent.forwarded', {
              queueSize: clientContentQueue.length,
              turnCount: payload.turns?.length ?? 0,
              turnComplete: payload.turnComplete,
              latencyMs: Date.now() - payload.receivedAt,
            });
          }
        } finally {
          drainingClientContentQueue = false;
        }
      };

      const connectGeminiForCurrentContext = async (
        ws: WSContext<WebSocket>,
      ) => {
        geminiBridge = await connectGeminiLiveBridge({
          ws,
          userId: session.user.id,
          projectId,
          activeSubAgents,
          purpose,
          debugSessionId,
        });

        await drainRealtimeQueue(ws);
        await drainClientContentQueue();
      };

      const rotateGeminiSessionForContext = async (
        ws: WSContext<WebSocket>,
        reason: string,
      ) => {
        if (drainingQueue) {
          await drainRealtimeQueue(ws);
        }

        geminiBridge?.close();
        geminiBridge = null;

        await connectGeminiForCurrentContext(ws);

        ws.send(
          JSON.stringify({
            type: 'agent.session.rotated',
            payload: {
              reason,
              projectId,
              activeSubAgents,
              purpose,
            },
          }),
        );

        recordActionSent(debugSessionId, 'agent.session.rotated', {
          reason,
          projectId,
          activeSubAgents,
          purpose,
        });
      };

      return {
        async onOpen(_event, ws) {
          debugSessionId = createDebugSession({
            userId: session.user.id,
            projectId,
          });

          try {
            await connectGeminiForCurrentContext(ws);
          } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : 'Failed to initialize Gemini live session';

            ws.send(
              JSON.stringify({
                type: 'error',
                payload: message,
              }),
            );
            recordActionSent(debugSessionId, 'error', {
              payload: message,
            });
            ws.close(1011, 'Gemini bridge init failed');
            return;
          }

          ws.send(JSON.stringify({ type: 'ws.ready' }));
          recordActionSent(debugSessionId, 'ws.ready');
        },
        onMessage(event, ws) {
          recordActionReceived(debugSessionId, 'ws.raw', {
            inputType: typeof event.data === 'string' ? 'string' : 'binary',
          });

          const msg = safeParseMessage(event.data);
          if (!msg) {
            ws.send(
              JSON.stringify({
                type: 'error',
                payload: 'Invalid websocket payload',
              }),
            );
            recordActionSent(debugSessionId, 'error', {
              payload: 'Invalid websocket payload',
            });
            return;
          }

          recordActionReceived(debugSessionId, msg.type, msg.payload);

          if (msg.type === 'agent.context') {
            const nextProjectId = msg.payload.projectId;
            const nextProjectName =
              msg.payload.projectName?.trim() || undefined;
            const nextActiveSubAgents = sanitizeActiveSubAgents(
              msg.payload.activeSubAgents,
            );
            const nextPurpose = msg.payload.purpose?.trim() || undefined;

            const nextAgentContextKey = createAgentContextKey({
              projectId: nextProjectId,
              activeSubAgents: nextActiveSubAgents,
              purpose: nextPurpose,
            });

            projectId = nextProjectId;
            projectName = nextProjectName;
            activeSubAgents = nextActiveSubAgents;
            purpose = nextPurpose;

            updateDebugSession(debugSessionId, { projectId });

            const contextChanged = nextAgentContextKey !== agentContextKey;
            agentContextKey = nextAgentContextKey;

            ws.send(
              JSON.stringify({
                type: 'agent.context.updated',
                payload: {
                  projectId,
                  projectName,
                  activeSubAgents,
                  purpose,
                  contextChanged,
                },
              }),
            );
            recordActionSent(debugSessionId, 'agent.context.updated', {
              projectId,
              projectName,
              activeSubAgents,
              purpose,
              contextChanged,
            });

            if (contextChanged) {
              void (async () => {
                try {
                  await rotateGeminiSessionForContext(
                    ws,
                    'agent_context_changed',
                  );
                } catch (error) {
                  const message =
                    error instanceof Error
                      ? error.message
                      : 'Failed to rotate Gemini live session';

                  ws.send(
                    JSON.stringify({
                      type: 'error',
                      payload: message,
                    }),
                  );
                  recordActionSent(debugSessionId, 'error', {
                    payload: message,
                  });
                }
              })();
            }

            return;
          }

          if (msg.type === 'gemini.realtimeInput') {
            enqueueRealtimeChunk(
              {
                media: {
                  mimeType: msg.payload.media.mimeType,
                  data: msg.payload.media.data,
                },
                receivedAt: Date.now(),
              },
              ws,
            );
            void drainRealtimeQueue(ws);
            return;
          }

          if (msg.type === 'gemini.realtimeEnd') {
            if (!geminiBridge?.session) {
              recordActionSent(
                debugSessionId,
                'gemini.realtimeInput.audio_end.deferred',
                {
                  reason: msg.payload?.reason ?? 'client_stop',
                  queueSize: realtimeQueue.length,
                },
              );
              return;
            }

            void (async () => {
              await drainRealtimeQueue(ws);

              geminiBridge?.session?.sendRealtimeInput({
                audioStreamEnd: true,
              });

              recordActionSent(
                debugSessionId,
                'gemini.realtimeInput.audio_end',
                {
                  reason: msg.payload?.reason ?? 'client_stop',
                  queueSize: realtimeQueue.length,
                },
              );
            })();
            return;
          }

          if (msg.type === 'gemini.clientContent') {
            if (!geminiBridge?.session) {
              enqueueClientContent(msg.payload);
              return;
            }

            geminiBridge.session.sendClientContent({
              turns: msg.payload.turns as never,
              turnComplete: msg.payload.turnComplete,
            });
            recordActionSent(debugSessionId, 'gemini.clientContent.forwarded', {
              turnCount: msg.payload.turns?.length ?? 0,
              turnComplete: msg.payload.turnComplete,
            });
            return;
          }

          if (!geminiBridge?.session) {
            ws.send(
              JSON.stringify({
                type: 'error',
                payload: 'Gemini session not ready',
              }),
            );
            recordActionSent(debugSessionId, 'error', {
              payload: 'Gemini session not ready',
            });
            return;
          }
        },
        onClose() {
          realtimeQueue.splice(0, realtimeQueue.length);
          clientContentQueue.splice(0, clientContentQueue.length);
          geminiBridge?.close();
          closeDebugSession(debugSessionId, 'ws.closed');
        },
      };
    }),
  );

  return { injectWebSocket };
}

function safeParseMessage(input: string | ArrayBuffer): ClientMessage | null {
  try {
    const raw =
      typeof input === 'string' ? input : Buffer.from(input).toString('utf-8');
    const parsed = JSON.parse(raw) as ClientMessage;
    return parsed;
  } catch {
    return null;
  }
}
