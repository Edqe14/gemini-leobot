import {
  GoogleGenAI,
  Modality,
  type LiveServerMessage,
  type Session,
} from '@google/genai';
import type { WSContext } from 'hono/ws';
import { env } from './env';
import { handleAgentToolCall } from '../services/agent-router';

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

type BridgeContext = {
  ws: WSContext<WebSocket>;
  userId: string;
  projectId?: string;
};

export async function connectGeminiLiveBridge(context: BridgeContext) {
  let session: Session | null = null;

  session = await ai.live.connect({
    model: env.GEMINI_LIVE_MODEL,
    config: {
      responseModalities: [Modality.TEXT, Modality.AUDIO],
    },
    callbacks: {
      onmessage: async (message: LiveServerMessage) => {
        context.ws.send(
          JSON.stringify({ type: 'gemini.server', payload: message }),
        );

        const toolCall = message.toolCall;
        if (toolCall?.functionCalls?.length) {
          const responses = await Promise.all(
            toolCall.functionCalls.map(async (call) => {
              const toolName = call.name ?? 'unknown_tool';
              const result = await handleAgentToolCall({
                userId: context.userId,
                projectId: context.projectId,
                name: toolName,
                args: call.args,
              });
              return {
                id: call.id,
                name: toolName,
                response: {
                  output: JSON.stringify(result),
                },
              };
            }),
          );

          session?.sendToolResponse({
            functionResponses: responses,
          });
        }
      },
      onerror: (error) => {
        context.ws.send(
          JSON.stringify({ type: 'gemini.error', payload: error.message }),
        );
      },
      onclose: () => {
        context.ws.send(JSON.stringify({ type: 'gemini.closed' }));
      },
    },
  });

  return {
    session,
    close: () => {
      session?.close();
      session = null;
    },
  };
}
