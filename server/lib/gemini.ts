import {
  ActivityHandling,
  EndSensitivity,
  GoogleGenAI,
  Modality,
  StartSensitivity,
  TurnCoverage,
  VoiceActivityType,
  type FunctionResponse,
  type GoogleGenAIOptions,
  type LiveServerMessage,
  type Session,
} from '@google/genai';
import type { WSContext } from 'hono/ws';
import { env } from './env';
import { handleAgentToolCall } from '../services/agent-router';
import {
  buildActiveAgentSystemInstruction,
  getActiveAgentToolDeclarations,
} from '../agents';
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

export async function connectGeminiLiveBridge(context: BridgeContext) {
  let session: Session | null = null;
  const toolDeclarations = getActiveAgentToolDeclarations({
    projectId: context.projectId,
  });

  session = await ai.live.connect({
    model: env.GEMINI_LIVE_MODEL,
    config: {
      systemInstruction: buildActiveAgentSystemInstruction({
        projectId: context.projectId,
        activeSubAgents: context.activeSubAgents,
        purpose: context.purpose,
      }),
      responseModalities: [Modality.AUDIO],
      tools: [
        {
          functionDeclarations: toolDeclarations,
        },
      ],
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

              const resultOk =
                result &&
                typeof result === 'object' &&
                (result as Record<string, unknown>).ok === true;
              const shouldNotifyProjectChanged =
                resultOk &&
                [
                  'create_story_node',
                  'sync_story_node',
                  'generate_character_brief',
                  'generate_character_inspiration',
                  'get_project_style_node',
                  'upsert_project_style_node',
                  'refine_project_style_node',
                  'generate_storyboard',
                ].includes(toolName);

              if (
                shouldNotifyProjectChanged &&
                typeof context.projectId === 'string' &&
                context.projectId.trim()
              ) {
                context.ws.send(
                  JSON.stringify({
                    type: 'agent.project.changed',
                    payload: {
                      projectId: context.projectId,
                      sourceTool: toolName,
                    },
                  }),
                );

                recordMonitorActionSent(
                  context.debugSessionId,
                  'agent.project.changed',
                  {
                    projectId: context.projectId,
                    sourceTool: toolName,
                  },
                );
              }

              if (
                toolName === 'set_active_project' &&
                ok &&
                result &&
                typeof result === 'object'
              ) {
                const agentContext = (result as Record<string, unknown>)
                  .agentContext;
                const nextProjectId =
                  agentContext && typeof agentContext === 'object'
                    ? (agentContext as Record<string, unknown>).projectId
                    : undefined;
                const activeProject =
                  (result as Record<string, unknown>).project ?? undefined;
                const nextProjectName =
                  activeProject && typeof activeProject === 'object'
                    ? (activeProject as Record<string, unknown>).name
                    : undefined;

                if (typeof nextProjectId === 'string' && nextProjectId.trim()) {
                  context.ws.send(
                    JSON.stringify({
                      type: 'agent.context.request',
                      payload: {
                        projectId: nextProjectId,
                        projectName:
                          typeof nextProjectName === 'string'
                            ? nextProjectName
                            : undefined,
                      },
                    }),
                  );

                  recordMonitorActionSent(
                    context.debugSessionId,
                    'agent.context.request',
                    {
                      projectId: nextProjectId,
                      projectName:
                        typeof nextProjectName === 'string'
                          ? nextProjectName
                          : undefined,
                      sourceTool: toolName,
                    },
                  );
                }
              }

              return {
                id: call.id,
                name: toolName,
                response: {
                  output: result,
                },
              } satisfies FunctionResponse;
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
