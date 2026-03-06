import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import { Captions, CaptionsOff, Mic, MicOff, User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AuthGate } from '@/components/auth-gate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { initialEdges, initialNodes } from '@/features/flow/nodes';
import { createAgentSocket } from '@/lib/ws-client';

import '@xyflow/react/dist/style.css';

type DebugMonitorResponse = {
  monitor?: {
    enabled?: boolean;
  };
};

type AudioChunk = {
  mimeType: string;
  data: string;
};

type VoiceState = 'idle' | 'active';

type CaptionSpeaker = 'You' | 'Leo';

type CaptionLine = {
  speaker: CaptionSpeaker;
  text: string;
};

const CAPTION_IDLE_CLEAR_MS = 10000;

function mergeCaptionText(previous: string, incoming: string): string {
  const prev = previous.trim();
  const next = incoming.trim();

  if (!next) {
    return prev;
  }

  if (!prev) {
    return next;
  }

  if (next === prev || prev.endsWith(` ${next}`)) {
    return prev;
  }

  if (next.startsWith(prev) || prev.startsWith(next)) {
    return next;
  }

  if (/^[.,!?;:]+$/.test(next)) {
    return `${prev}${next}`;
  }

  return `${prev} ${next}`;
}

function updateCaptionLines(
  current: CaptionLine[],
  speaker: CaptionSpeaker,
  text: string,
): CaptionLine[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return current;
  }

  const next = [...current];
  const last = next[next.length - 1];

  if (!last || last.speaker !== speaker) {
    next.push({ speaker, text: trimmed });
    return next.slice(-12);
  }

  const merged = mergeCaptionText(last.text, trimmed);
  if (merged === last.text) {
    return next;
  }

  next[next.length - 1] = { speaker, text: merged };
  return next.slice(-12);
}

function extractAudioChunks(payload: unknown): AudioChunk[] {
  const chunks: AudioChunk[] = [];

  const walk = (value: unknown) => {
    if (!value || typeof value !== 'object') {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }

    const record = value as Record<string, unknown>;
    const mimeType = record.mimeType;
    const data = record.data;

    if (
      typeof mimeType === 'string' &&
      typeof data === 'string' &&
      mimeType.toLowerCase().startsWith('audio/')
    ) {
      chunks.push({ mimeType, data });
      return;
    }

    Object.values(record).forEach(walk);
  };

  walk(payload);
  return chunks;
}

function extractOutputTranscription(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const serverContent = record.serverContent;
  if (!serverContent || typeof serverContent !== 'object') {
    return null;
  }

  const contentRecord = serverContent as Record<string, unknown>;
  const outputTranscription = contentRecord.outputTranscription;
  if (!outputTranscription || typeof outputTranscription !== 'object') {
    return null;
  }

  const text = (outputTranscription as Record<string, unknown>).text;
  return typeof text === 'string' && text.trim() ? text.trim() : null;
}

function extractInputTranscription(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const serverContent = record.serverContent;
  if (!serverContent || typeof serverContent !== 'object') {
    return null;
  }

  const contentRecord = serverContent as Record<string, unknown>;
  const inputTranscription = contentRecord.inputTranscription;
  if (!inputTranscription || typeof inputTranscription !== 'object') {
    return null;
  }

  const text = (inputTranscription as Record<string, unknown>).text;
  return typeof text === 'string' && text.trim() ? text.trim() : null;
}

function extractVoiceState(payload: unknown): VoiceState | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const voiceActivity = record.voiceActivity;
  if (!voiceActivity || typeof voiceActivity !== 'object') {
    const vadSignal = record.voiceActivityDetectionSignal;
    if (!vadSignal || typeof vadSignal !== 'object') {
      return null;
    }

    const vadSignalType = (vadSignal as Record<string, unknown>).vadSignalType;
    if (vadSignalType === 'VAD_SIGNAL_TYPE_SOS') {
      return 'active';
    }

    if (vadSignalType === 'VAD_SIGNAL_TYPE_EOS') {
      return 'idle';
    }

    return null;
  }

  const voiceActivityType = (voiceActivity as Record<string, unknown>)
    .voiceActivityType;
  if (voiceActivityType === 'ACTIVITY_START') {
    return 'active';
  }

  if (voiceActivityType === 'ACTIVITY_END') {
    return 'idle';
  }

  return null;
}

function parsePcmRate(mimeType: string): number {
  const match = /rate=(\d+)/i.exec(mimeType);
  if (!match) {
    return 24000;
  }

  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 24000;
  }

  return parsed;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const tagName = target.tagName;
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
}

function base64ToPcm16(base64Data: string): Int16Array {
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Int16Array(bytes.buffer);
}

function pcm16ToAudioBuffer(
  context: AudioContext,
  pcm16: Int16Array,
  sampleRate: number,
): AudioBuffer {
  const float32 = new Float32Array(pcm16.length);
  for (let index = 0; index < pcm16.length; index += 1) {
    float32[index] = pcm16[index] / 0x8000;
  }

  const buffer = context.createBuffer(1, float32.length, sampleRate);
  buffer.copyToChannel(float32, 0);
  return buffer;
}

export function CanvasPage() {
  return (
    <AuthGate>
      {({ userName }) => (
        <ReactFlowProvider>
          <CreativeAgentCanvas userName={userName} />
        </ReactFlowProvider>
      )}
    </AuthGate>
  );
}

function CreativeAgentCanvas({ userName }: { userName: string }) {
  const navigate = useNavigate();
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);
  const [micActive, setMicActive] = useState(false);
  const [micError, setMicError] = useState('');
  const [connected, setConnected] = useState(false);
  const [socketStatus, setSocketStatus] = useState(
    'connecting voice socket...',
  );
  const [sentChunks, setSentChunks] = useState(0);
  const [ingestedChunks, setIngestedChunks] = useState(0);
  const [debugOverlayEnabled, setDebugOverlayEnabled] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [loopbackEnabled, setLoopbackEnabled] = useState(false);
  const [ccEnabled, setCcEnabled] = useState(true);
  const [captionLines, setCaptionLines] = useState<CaptionLine[]>([]);
  const [showInterruptedBadge, setShowInterruptedBadge] = useState(false);
  const [projectName, setProjectName] = useState<string>('No active project');
  const [debugTextInput, setDebugTextInput] = useState('');
  const socketClientRef = useRef<ReturnType<typeof createAgentSocket> | null>(
    null,
  );
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const sinkGainNodeRef = useRef<GainNode | null>(null);
  const loopbackGainNodeRef = useRef<GainNode | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const playbackCursorRef = useRef(0);
  const playbackSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const interruptedBadgeTimerRef = useRef<number | null>(null);
  const captionClearTimerRef = useRef<number | null>(null);
  const micActiveRef = useRef(false);
  const micStartingRef = useRef(false);
  const pttHeldRef = useRef(false);
  const pttMicActivatedRef = useRef(false);

  const interruptPlayback = useCallback(() => {
    const activeSources = playbackSourcesRef.current;
    let didInterrupt = false;

    if (activeSources.size > 0) {
      didInterrupt = true;
      for (const source of activeSources) {
        try {
          source.stop();
        } catch {
          // no-op
        }
        source.disconnect();
      }
      activeSources.clear();
    }

    const playbackContext = playbackContextRef.current;
    if (playbackContext) {
      playbackCursorRef.current = playbackContext.currentTime;
    }

    return didInterrupt;
  }, []);

  const notifyInterrupted = useCallback(() => {
    setShowInterruptedBadge(true);
    if (interruptedBadgeTimerRef.current) {
      window.clearTimeout(interruptedBadgeTimerRef.current);
    }

    interruptedBadgeTimerRef.current = window.setTimeout(() => {
      setShowInterruptedBadge(false);
      interruptedBadgeTimerRef.current = null;
    }, 1200);
  }, []);

  useEffect(() => {
    let mounted = true;

    void fetch('/api/debug/monitor', { credentials: 'include' })
      .then((response) => {
        if (!response.ok) {
          return null;
        }

        return response.json() as Promise<DebugMonitorResponse>;
      })
      .then((payload) => {
        if (!mounted || !payload) {
          return;
        }

        setDebugOverlayEnabled(Boolean(payload.monitor?.enabled));
      })
      .catch(() => {
        if (mounted) {
          setDebugOverlayEnabled(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (captionClearTimerRef.current) {
      window.clearTimeout(captionClearTimerRef.current);
      captionClearTimerRef.current = null;
    }

    if (!captionLines.length) {
      return;
    }

    captionClearTimerRef.current = window.setTimeout(() => {
      setCaptionLines([]);
      captionClearTimerRef.current = null;
    }, CAPTION_IDLE_CLEAR_MS);
  }, [captionLines]);

  useEffect(() => {
    const client = createAgentSocket({
      onOpen: () => {
        setConnected(true);
        setSocketStatus('voice socket connected');
        setVoiceState('idle');
      },
      onClose: () => {
        setConnected(false);
        setSocketStatus('voice socket disconnected, retrying...');
        setVoiceState('idle');
      },
      onError: (message) => {
        setSocketStatus(message);
      },
      onCloseDetail: ({ code, reason }) => {
        if (reason) {
          setSocketStatus(`socket closed (${code}): ${reason}`);
          return;
        }

        setSocketStatus(`socket closed (${code}), retrying...`);
      },
      onMessage: (message) => {
        if (message.type === 'error') {
          const payload =
            typeof message.payload === 'string'
              ? message.payload
              : 'WebSocket server error';
          setSocketStatus(payload);
          return;
        }

        if (message.type === 'ws.ready') {
          setSocketStatus('voice socket ready');
          return;
        }

        if (message.type === 'agent.context.updated') {
          setProjectName('Active project');
          return;
        }

        if (message.type === 'ws.audio.ingested') {
          const payload = message.payload as
            | { ingestedChunks?: number }
            | undefined;
          if (typeof payload?.ingestedChunks === 'number') {
            setIngestedChunks(payload.ingestedChunks);
          }
          return;
        }

        if (message.type === 'gemini.voiceActivity') {
          const payload = message.payload as
            | { state?: 'idle' | 'active'; source?: string }
            | undefined;
          if (payload?.state) {
            setVoiceState(payload.state);
            if (payload.state === 'active') {
              const didInterrupt = interruptPlayback();
              if (didInterrupt) {
                notifyInterrupted();
              }
            }
          }
          return;
        }

        if (message.type === 'gemini.server') {
          const payload = message.payload;
          const nextVoiceState = extractVoiceState(payload);
          if (nextVoiceState) {
            setVoiceState(nextVoiceState);
            if (nextVoiceState === 'active') {
              const didInterrupt = interruptPlayback();
              if (didInterrupt) {
                notifyInterrupted();
              }
            }
          }

          const input = extractInputTranscription(payload);
          if (input) {
            setCaptionLines((value) => updateCaptionLines(value, 'You', input));
          }

          const transcription = extractOutputTranscription(payload);
          if (transcription) {
            setCaptionLines((value) =>
              updateCaptionLines(value, 'Leo', transcription),
            );
          }

          const chunks = extractAudioChunks(payload);
          if (!chunks.length) {
            return;
          }

          if (!playbackContextRef.current) {
            playbackContextRef.current = new window.AudioContext();
            playbackCursorRef.current = playbackContextRef.current.currentTime;
          }

          const playbackContext = playbackContextRef.current;
          if (!playbackContext) {
            return;
          }

          if (playbackContext.state === 'suspended') {
            void playbackContext.resume();
          }

          for (const chunk of chunks) {
            if (!chunk.mimeType.toLowerCase().startsWith('audio/pcm')) {
              continue;
            }

            const sampleRate = parsePcmRate(chunk.mimeType);
            const pcm16 = base64ToPcm16(chunk.data);
            const audioBuffer = pcm16ToAudioBuffer(
              playbackContext,
              pcm16,
              sampleRate,
            );

            const source = playbackContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(playbackContext.destination);
            playbackSourcesRef.current.add(source);
            source.onended = () => {
              source.disconnect();
              playbackSourcesRef.current.delete(source);
            };

            const startAt = Math.max(
              playbackContext.currentTime,
              playbackCursorRef.current,
            );
            source.start(startAt);
            playbackCursorRef.current = startAt + audioBuffer.duration;
          }
        }
      },
    });

    socketClientRef.current = client;

    return () => {
      client.close();
      socketClientRef.current = null;
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;

      processorNodeRef.current?.disconnect();
      sourceNodeRef.current?.disconnect();
      sinkGainNodeRef.current?.disconnect();
      loopbackGainNodeRef.current?.disconnect();
      void audioContextRef.current?.close();

      processorNodeRef.current = null;
      sourceNodeRef.current = null;
      sinkGainNodeRef.current = null;
      loopbackGainNodeRef.current = null;
      audioContextRef.current = null;

      void playbackContextRef.current?.close();
      playbackContextRef.current = null;
      playbackCursorRef.current = 0;

      if (interruptedBadgeTimerRef.current) {
        window.clearTimeout(interruptedBadgeTimerRef.current);
        interruptedBadgeTimerRef.current = null;
      }

      if (captionClearTimerRef.current) {
        window.clearTimeout(captionClearTimerRef.current);
        captionClearTimerRef.current = null;
      }
    };
  }, [interruptPlayback, notifyInterrupted]);

  const stopMicCapture = useCallback(() => {
    interruptPlayback();

    socketClientRef.current?.send({
      type: 'gemini.realtimeEnd',
      payload: { reason: 'mic_stopped' },
    });

    processorNodeRef.current?.disconnect();
    sourceNodeRef.current?.disconnect();
    sinkGainNodeRef.current?.disconnect();
    loopbackGainNodeRef.current?.disconnect();
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());

    void audioContextRef.current?.close();

    processorNodeRef.current = null;
    sourceNodeRef.current = null;
    sinkGainNodeRef.current = null;
    loopbackGainNodeRef.current = null;
    audioContextRef.current = null;
    mediaStreamRef.current = null;
    setMicActive(false);
  }, [interruptPlayback]);

  useEffect(() => {
    micActiveRef.current = micActive;
  }, [micActive]);

  const bytesToBase64 = (bytes: Uint8Array) => {
    let binary = '';
    const chunkSize = 0x8000;

    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const chunk = bytes.subarray(
        offset,
        Math.min(offset + chunkSize, bytes.length),
      );
      binary += String.fromCharCode(...chunk);
    }

    return btoa(binary);
  };

  const downsampleTo16k = (input: Float32Array, inputSampleRate: number) => {
    const targetSampleRate = 16000;
    if (inputSampleRate === targetSampleRate) {
      return input;
    }

    if (inputSampleRate < targetSampleRate) {
      return input;
    }

    const sampleRateRatio = inputSampleRate / targetSampleRate;
    const newLength = Math.round(input.length / sampleRateRatio);
    const output = new Float32Array(newLength);

    let offsetResult = 0;
    let offsetBuffer = 0;

    while (offsetResult < output.length) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
      let accumulator = 0;
      let count = 0;

      for (
        let index = offsetBuffer;
        index < nextOffsetBuffer && index < input.length;
        index += 1
      ) {
        accumulator += input[index];
        count += 1;
      }

      output[offsetResult] = count > 0 ? accumulator / count : 0;
      offsetResult += 1;
      offsetBuffer = nextOffsetBuffer;
    }

    return output;
  };

  const convertToPcm16 = (input: Float32Array) => {
    const pcm16 = new Int16Array(input.length);

    for (let index = 0; index < input.length; index += 1) {
      const clamped = Math.max(-1, Math.min(1, input[index]));
      pcm16[index] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    }

    return new Uint8Array(pcm16.buffer);
  };

  const startMicCapture = useCallback(
    async (options?: { requirePttHeld?: boolean }) => {
      if (micActiveRef.current || micStartingRef.current) {
        return;
      }

      micStartingRef.current = true;
      setMicError('');
      setSentChunks(0);
      setIngestedChunks(0);

      try {
        if (!connected) {
          throw new Error('Voice socket is not connected yet.');
        }

        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error(
            'Microphone capture is not supported in this browser.',
          );
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            sampleRate: 48000,
            sampleSize: 16,
            noiseSuppression: true,
            echoCancellation: true,
            autoGainControl: true,
          },
        });

        // Avoid getting stuck if key-up happens while permissions are pending.
        if (options?.requirePttHeld && !pttHeldRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        mediaStreamRef.current = stream;

        const audioContext = new window.AudioContext();
        await audioContext.resume();

        const source = audioContext.createMediaStreamSource(stream);
        const processor = audioContext.createScriptProcessor(4096, 1, 1);
        const sinkGain = audioContext.createGain();
        const loopbackGain = audioContext.createGain();
        sinkGain.gain.value = 0;
        loopbackGain.gain.value = loopbackEnabled ? 1 : 0;

        source.connect(processor);
        processor.connect(sinkGain);
        sinkGain.connect(audioContext.destination);
        source.connect(loopbackGain);
        loopbackGain.connect(audioContext.destination);

        audioContextRef.current = audioContext;
        sourceNodeRef.current = source;
        processorNodeRef.current = processor;
        sinkGainNodeRef.current = sinkGain;
        loopbackGainNodeRef.current = loopbackGain;

        processor.onaudioprocess = (event) => {
          const channelData = event.inputBuffer.getChannelData(0);
          if (!channelData || channelData.length === 0) {
            return;
          }

          const downsampled = downsampleTo16k(
            channelData,
            audioContext.sampleRate,
          );
          const pcmBytes = convertToPcm16(downsampled);
          const data = bytesToBase64(pcmBytes);

          socketClientRef.current?.send({
            type: 'gemini.realtimeInput',
            payload: {
              media: {
                mimeType: 'audio/pcm;rate=16000',
                data,
              },
            },
          });
          setSentChunks((value) => value + 1);
        };
        setMicActive(true);
      } catch (error) {
        stopMicCapture();
        setMicError(
          error instanceof Error
            ? error.message
            : 'Failed to start microphone capture.',
        );
      } finally {
        micStartingRef.current = false;
      }
    },
    [connected, loopbackEnabled, stopMicCapture],
  );

  useEffect(() => {
    const loopbackGain = loopbackGainNodeRef.current;
    if (!loopbackGain) {
      return;
    }

    loopbackGain.gain.value = loopbackEnabled ? 1 : 0;
  }, [loopbackEnabled]);

  const toggleMic = async () => {
    if (micActive) {
      stopMicCapture();
      return;
    }

    await startMicCapture();
  };

  const sendDebugTextInput = useCallback(() => {
    const text = debugTextInput.trim();
    if (!text) {
      return;
    }

    if (!connected) {
      setMicError('Voice socket is not connected yet.');
      return;
    }

    socketClientRef.current?.send({
      type: 'gemini.clientContent',
      payload: {
        turns: [
          {
            role: 'user',
            parts: [{ text }],
          },
        ],
        turnComplete: true,
      },
    });

    setCaptionLines((value) => updateCaptionLines(value, 'You', text));

    setDebugTextInput('');
    setMicError('');
  }, [connected, debugTextInput]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) {
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      if (micActiveRef.current || pttHeldRef.current) {
        return;
      }

      pttHeldRef.current = true;
      pttMicActivatedRef.current = true;
      event.preventDefault();
      void startMicCapture({ requirePttHeld: true });
    };

    const releasePtt = () => {
      if (!pttHeldRef.current) {
        return;
      }

      pttHeldRef.current = false;

      if (!pttMicActivatedRef.current) {
        return;
      }

      pttMicActivatedRef.current = false;
      if (micActiveRef.current) {
        stopMicCapture();
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') {
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      event.preventDefault();
      releasePtt();
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        releasePtt();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', releasePtt);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', releasePtt);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [startMicCapture, stopMicCapture]);

  useEffect(() => {
    if (!connected && micActive) {
      stopMicCapture();
      setMicError('Voice socket disconnected.');
    }
  }, [connected, micActive, stopMicCapture]);

  return (
    <div className='h-screen w-screen bg-background p-6 text-foreground'>
      <Card className='relative h-full w-full overflow-hidden rounded-4xl border-2 border-border'>
        <div className='absolute left-6 top-6 z-10 flex items-center gap-2'>
          <Badge variant='outline' className='bg-background px-4 py-2 text-sm'>
            {projectName}
          </Badge>
          <Button variant='outline' onClick={() => navigate('/debug')}>
            Debug Monitor
          </Button>
        </div>

        <div className='absolute right-6 top-6 z-10'>
          <Button variant='outline' size='icon' className='rounded-full'>
            <User className='h-5 w-5' />
          </Button>
          <p className='mt-1 text-right text-xs text-muted-foreground'>
            {userName || 'profile'}
          </p>

          {debugOverlayEnabled ? (
            <div className='mt-2 space-y-2'>
              <Badge variant='outline'>voice: {voiceState}</Badge>
              <label className='flex items-center justify-end gap-2 text-xs text-muted-foreground'>
                <span>loopback audio</span>
                <input
                  type='checkbox'
                  checked={loopbackEnabled}
                  onChange={(event) => setLoopbackEnabled(event.target.checked)}
                />
              </label>
            </div>
          ) : null}
        </div>

        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          fitView
          className='bg-background'>
          <MiniMap pannable zoomable />
          <Controls />
          <Background gap={24} size={1} />
        </ReactFlow>

        <div className='absolute bottom-6 left-1/2 z-10 w-full max-w-xl -translate-x-1/2 px-6'>
          {ccEnabled && captionLines.length > 0 ? (
            <Card className='mb-3 border border-border bg-card/95 p-3'>
              <div className='space-y-1 text-xs'>
                {captionLines.map((line, index) => (
                  <p
                    key={`${line.speaker}-${index}-${line.text}`}
                    className='text-muted-foreground'>
                    <span className='font-medium text-foreground'>
                      {line.speaker}:
                    </span>{' '}
                    {line.text}
                  </p>
                ))}
              </div>
            </Card>
          ) : null}

          <div className='flex items-center justify-center gap-2'>
            <Button
              variant={ccEnabled ? 'default' : 'outline'}
              className='rounded-2xl'
              onClick={() => setCcEnabled((value) => !value)}>
              {ccEnabled ? (
                <Captions className='mr-2 h-4 w-4' />
              ) : (
                <CaptionsOff className='mr-2 h-4 w-4' />
              )}
              CC
            </Button>

            <Button
              variant={micActive ? 'default' : 'outline'}
              className='min-w-28 rounded-2xl'
              onClick={() => void toggleMic()}>
              {micActive ? (
                <Mic className='mr-2 h-4 w-4' />
              ) : (
                <MicOff className='mr-2 h-4 w-4' />
              )}
              Mic
            </Button>
          </div>
          {showInterruptedBadge ? (
            <div className='mt-1 flex justify-center'>
              <Badge variant='outline'>Leo interrupted</Badge>
            </div>
          ) : null}
          <p className='mt-1 text-center text-xs text-muted-foreground'>
            {socketStatus}
          </p>
          <p className='mt-1 text-center text-xs text-muted-foreground'>
            chunks sent: {sentChunks} • backend ingested: {ingestedChunks}
          </p>
          {debugOverlayEnabled ? (
            <div className='mt-3 flex items-center gap-2'>
              <input
                type='text'
                value={debugTextInput}
                onChange={(event) => setDebugTextInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    sendDebugTextInput();
                  }
                }}
                placeholder='Debug: type instead of talking'
                className='h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm'
              />
              <Button
                variant='outline'
                className='h-9 rounded-md'
                disabled={!debugTextInput.trim() || !connected}
                onClick={sendDebugTextInput}>
                Send
              </Button>
            </div>
          ) : null}
          {!micActive ? (
            <p className='mt-1 text-center text-xs text-muted-foreground'>
              Hold Space to push-to-talk
            </p>
          ) : null}
          {micError ? (
            <p className='mt-1 text-center text-xs text-muted-foreground'>
              {micError}
            </p>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
