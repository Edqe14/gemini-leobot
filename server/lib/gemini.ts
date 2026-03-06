import {
  ActivityHandling,
  EndSensitivity,
  GoogleGenAI,
  Modality,
  StartSensitivity,
  TurnCoverage,
  VoiceActivityType,
  type GoogleGenAIOptions,
  type LiveServerMessage,
  type Session,
} from '@google/genai';
import type { WSContext } from 'hono/ws';
import { env } from './env';
import { handleAgentToolCall } from '../services/agent-router';
import {
  recordActionSent as recordMonitorActionSent,
  recordAgentEnd as recordMonitorAgentEnd,
  recordAgentStart as recordMonitorAgentStart,
  recordGeminiError as recordMonitorGeminiError,
  recordGeminiMessage as recordMonitorGeminiMessage,
  recordVoiceActivity as recordMonitorVoiceActivity,
} from './debug-monitor';

function getGoogleGenAIOptions(): GoogleGenAIOptions {
  if (env.GEMINI_PROVIDER === 'vertex') {
    return {
      vertexai: true,
      project: env.GOOGLE_CLOUD_PROJECT,
      location: env.GOOGLE_CLOUD_LOCATION,
    };
  }

  return {
    vertexai: false,
    apiKey: env.GEMINI_API_KEY,
  };
}

const ai = new GoogleGenAI(getGoogleGenAIOptions());

type BridgeContext = {
  ws: WSContext<WebSocket>;
  userId: string;
  projectId?: string;
  activeSubAgents?: string[];
  purpose?: string;
  debugSessionId: string;
};

function normalizeAgentName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '_');
}

function buildLeoSystemInstruction(context: {
  projectId?: string;
  activeSubAgents?: string[];
  purpose?: string;
}) {
  const isHomeContext = !context.projectId;
  const activeSubAgents = Array.from(
    new Set((context.activeSubAgents ?? []).map(normalizeAgentName)),
  );

  const homeContextNote = isHomeContext
    ? 'Current context: Home (no active project selected).'
    : 'Current context: Active project session.';

  const activeAgentsNote = activeSubAgents.length
    ? `Active sub-agents: ${activeSubAgents.join(', ')}.`
    : 'Active sub-agents: none.';

  const purposeNote = context.purpose?.trim()
    ? `Current user purpose: ${context.purpose.trim()}.`
    : 'Current user purpose: general creative collaboration.';

  return [
    "You are Leo, a creative directors' copilot, helping users design and visualize their story.",
    homeContextNote,
    activeAgentsNote,
    purposeNote,
    'When the user asks what you can do, asks for your capabilities, asks for help, or asks what you can do here, always answer with a concise numbered capabilities list first.',
    'Capabilities to include in that list:',
    '1. Import a story from markdown/Google Docs into a project.',
    '2. Generate character brief nodes from story context.',
    '3. Generate character design/style inspiration nodes.',
    '4. Generate storyboard draft nodes and shot outlines.',
    '5. Keep collaborating through short iterative creative direction.',
    'If no project is active, clearly separate what can be done right now from what requires opening or creating a project.',
    'When active sub-agents are provided, prioritize those capabilities and mention them explicitly in your response.',
    'Keep responses brief, practical, and action-oriented. Ask one follow-up question when needed.',
  ].join(' ');
}

export async function connectGeminiLiveBridge(context: BridgeContext) {
  let session: Session | null = null;

  session = await ai.live.connect({
    model: env.GEMINI_LIVE_MODEL,
    config: {
      systemInstruction: buildLeoSystemInstruction({
        projectId: context.projectId,
        activeSubAgents: context.activeSubAgents,
        purpose: context.purpose,
      }),
      responseModalities: [Modality.AUDIO],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      realtimeInputConfig: {
        activityHandling: ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
        turnCoverage: TurnCoverage.TURN_INCLUDES_ONLY_ACTIVITY,
        automaticActivityDetection: {
          disabled: false,
          startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
          endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_HIGH,
          prefixPaddingMs: 120,
          silenceDurationMs: 650,
        },
      },
    },
    callbacks: {
      onmessage: async (message: LiveServerMessage) => {
        recordMonitorGeminiMessage(context.debugSessionId, message, 'incoming');

        const voiceActivityType = message.voiceActivity?.voiceActivityType;
        const vadSignalType =
          message.voiceActivityDetectionSignal?.vadSignalType;

        if (voiceActivityType === VoiceActivityType.ACTIVITY_START) {
          recordMonitorVoiceActivity(context.debugSessionId, 'active', {
            source: 'gemini.voiceActivity',
            voiceActivityType,
          });

          context.ws.send(
            JSON.stringify({
              type: 'gemini.voiceActivity',
              payload: {
                state: 'active',
                source: 'voiceActivity',
              },
            }),
          );
        }

        if (voiceActivityType === VoiceActivityType.ACTIVITY_END) {
          recordMonitorVoiceActivity(context.debugSessionId, 'idle', {
            source: 'gemini.voiceActivity',
            voiceActivityType,
          });

          context.ws.send(
            JSON.stringify({
              type: 'gemini.voiceActivity',
              payload: {
                state: 'idle',
                source: 'voiceActivity',
              },
            }),
          );
        }

        if (vadSignalType === 'VAD_SIGNAL_TYPE_SOS') {
          recordMonitorVoiceActivity(context.debugSessionId, 'active', {
            source: 'gemini.vadSignal',
            vadSignalType,
          });

          context.ws.send(
            JSON.stringify({
              type: 'gemini.voiceActivity',
              payload: {
                state: 'active',
                source: 'vadSignal',
              },
            }),
          );
        }

        if (vadSignalType === 'VAD_SIGNAL_TYPE_EOS') {
          recordMonitorVoiceActivity(context.debugSessionId, 'idle', {
            source: 'gemini.vadSignal',
            vadSignalType,
          });

          context.ws.send(
            JSON.stringify({
              type: 'gemini.voiceActivity',
              payload: {
                state: 'idle',
                source: 'vadSignal',
              },
            }),
          );
        }

        context.ws.send(
          JSON.stringify({ type: 'gemini.server', payload: message }),
        );
        recordMonitorActionSent(context.debugSessionId, 'gemini.server', {
          hasToolCall: Boolean(message.toolCall),
        });

        const toolCall = message.toolCall;
        if (toolCall?.functionCalls?.length) {
          const responses = await Promise.all(
            toolCall.functionCalls.map(async (call) => {
              const toolName = call.name ?? 'unknown_tool';
              recordMonitorAgentStart(
                context.debugSessionId,
                toolName,
                call.args,
              );

              let result: unknown;
              let ok = true;

              try {
                result = await handleAgentToolCall({
                  userId: context.userId,
                  projectId: context.projectId,
                  name: toolName,
                  args: call.args,
                });
              } catch (error) {
                ok = false;
                const message =
                  error instanceof Error ? error.message : String(error);
                recordMonitorGeminiError(context.debugSessionId, message);
                result = {
                  ok: false,
                  message,
                };
              }

              recordMonitorAgentEnd(
                context.debugSessionId,
                toolName,
                ok,
                result,
              );

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
          recordMonitorActionSent(
            context.debugSessionId,
            'gemini.toolResponse',
            {
              responseCount: responses.length,
            },
          );
        }
      },
      onerror: (error) => {
        recordMonitorGeminiError(context.debugSessionId, error.message);
        context.ws.send(
          JSON.stringify({ type: 'gemini.error', payload: error.message }),
        );
        recordMonitorActionSent(context.debugSessionId, 'gemini.error', {
          message: error.message,
        });
      },
      onclose: () => {
        recordMonitorVoiceActivity(context.debugSessionId, 'idle', {
          source: 'gemini.onclose',
        });
        context.ws.send(JSON.stringify({ type: 'gemini.closed' }));
        recordMonitorActionSent(context.debugSessionId, 'gemini.closed');
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
