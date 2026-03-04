import { env } from './env';

type MonitorEventType =
  | 'session.open'
  | 'session.close'
  | 'session.update'
  | 'voice.activity'
  | 'connection.unauthorized'
  | 'action.received'
  | 'action.sent'
  | 'gemini.message'
  | 'gemini.error'
  | 'agent.start'
  | 'agent.end'
  | 'response.text';

type MonitorEvent = {
  id: string;
  at: string;
  sessionId?: string;
  userId?: string;
  projectId?: string;
  type: MonitorEventType;
  detail: Record<string, unknown>;
};

type SessionStatus = 'active' | 'closed';
type VoiceState = 'idle' | 'active';

type SessionState = {
  id: string;
  userId: string;
  projectId?: string;
  provider: 'ai_studio' | 'vertex';
  model: string;
  status: SessionStatus;
  openedAt: string;
  closedAt?: string;
  lastActivityAt: string;
  voiceState: VoiceState;
  lastVoiceActivityAt?: string;
  actionsReceived: number;
  actionsSent: number;
  geminiMessages: number;
  generatedTextChars: number;
  generatedTextLast?: string;
  activeAgents: string[];
  lastError?: string;
};

type MonitorSessionInternal = SessionState & {
  activeAgentSet: Set<string>;
};

type SessionInput = {
  userId: string;
  projectId?: string;
};

type SessionUpdateInput = {
  projectId?: string;
};

const MAX_SNIPPET_LENGTH = 280;

const state = {
  sessions: new Map<string, MonitorSessionInternal>(),
  events: [] as MonitorEvent[],
};

function nowIso() {
  return new Date().toISOString();
}

function randomId(prefix: string) {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

function truncate(value: string, length = MAX_SNIPPET_LENGTH) {
  if (value.length <= length) {
    return value;
  }

  return `${value.slice(0, length)}…`;
}

function summarizeUnknown(value: unknown): unknown {
  if (value === undefined || value === null) {
    return value;
  }

  if (typeof value === 'string') {
    return truncate(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return {
      kind: 'array',
      length: value.length,
      sample: value.slice(0, 2).map((item) => summarizeUnknown(item)),
    };
  }

  if (typeof value === 'object') {
    const input = value as Record<string, unknown>;
    const entries = Object.entries(input).slice(0, 8);
    return Object.fromEntries(
      entries.map(([key, item]): [string, unknown] => {
        if (key.toLowerCase().includes('data')) {
          if (typeof item === 'string') {
            return [key, `[string:${item.length}]`];
          }
          return [key, '[redacted]'];
        }

        if (key.toLowerCase().includes('audio')) {
          return [key, '[redacted-audio]'];
        }

        return [key, summarizeUnknown(item)];
      }),
    );
  }

  return String(value);
}

function pushEvent(event: Omit<MonitorEvent, 'id' | 'at'>) {
  if (!env.DEBUG_MONITOR_ENABLED) {
    return;
  }

  const storedEvent: MonitorEvent = {
    id: randomId('evt'),
    at: nowIso(),
    ...event,
  };

  state.events.push(storedEvent);
  if (state.events.length > env.DEBUG_MONITOR_MAX_EVENTS) {
    state.events.splice(0, state.events.length - env.DEBUG_MONITOR_MAX_EVENTS);
  }

  console.debug('[debug-monitor]', JSON.stringify(storedEvent));
}

function touchSession(session: MonitorSessionInternal) {
  session.lastActivityAt = nowIso();
}

function toPublicSession(session: MonitorSessionInternal): SessionState {
  return {
    ...session,
    activeAgents: [...session.activeAgentSet],
  };
}

function getSession(sessionId: string) {
  return state.sessions.get(sessionId);
}

function extractMessageTextParts(message: unknown): string[] {
  const textParts: string[] = [];
  const visited = new Set<unknown>();

  function walk(input: unknown) {
    if (input === null || input === undefined) {
      return;
    }

    if (typeof input === 'string') {
      return;
    }

    if (typeof input !== 'object') {
      return;
    }

    if (visited.has(input)) {
      return;
    }

    visited.add(input);

    if (Array.isArray(input)) {
      input.forEach(walk);
      return;
    }

    const record = input as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      if (key === 'text' && typeof value === 'string' && value.trim()) {
        textParts.push(value.trim());
      }

      walk(value);
    }
  }

  walk(message);
  return textParts;
}

export function createDebugSession(input: SessionInput) {
  const sessionId = randomId('ws');

  if (!env.DEBUG_MONITOR_ENABLED) {
    return sessionId;
  }

  const openedAt = nowIso();

  state.sessions.set(sessionId, {
    id: sessionId,
    userId: input.userId,
    projectId: input.projectId,
    provider: env.GEMINI_PROVIDER,
    model: env.GEMINI_LIVE_MODEL,
    status: 'active',
    openedAt,
    lastActivityAt: openedAt,
    voiceState: 'idle',
    actionsReceived: 0,
    actionsSent: 0,
    geminiMessages: 0,
    generatedTextChars: 0,
    activeAgents: [],
    activeAgentSet: new Set<string>(),
  });

  pushEvent({
    type: 'session.open',
    sessionId,
    userId: input.userId,
    projectId: input.projectId,
    detail: {
      provider: env.GEMINI_PROVIDER,
      model: env.GEMINI_LIVE_MODEL,
    },
  });

  return sessionId;
}

export function updateDebugSession(
  sessionId: string,
  input: SessionUpdateInput,
) {
  const session = getSession(sessionId);
  if (!session || !env.DEBUG_MONITOR_ENABLED) {
    return;
  }

  session.projectId = input.projectId;
  touchSession(session);

  pushEvent({
    type: 'session.update',
    sessionId,
    userId: session.userId,
    projectId: session.projectId,
    detail: { projectId: input.projectId },
  });
}

export function recordUnauthorizedConnection(detail: Record<string, unknown>) {
  pushEvent({
    type: 'connection.unauthorized',
    detail: summarizeUnknown(detail) as Record<string, unknown>,
  });
}

export function recordActionReceived(
  sessionId: string,
  actionType: string,
  payload?: unknown,
) {
  const session = getSession(sessionId);
  if (!session || !env.DEBUG_MONITOR_ENABLED) {
    return;
  }

  session.actionsReceived += 1;
  touchSession(session);

  pushEvent({
    type: 'action.received',
    sessionId,
    userId: session.userId,
    projectId: session.projectId,
    detail: {
      actionType,
      payload: summarizeUnknown(payload),
    },
  });
}

export function recordActionSent(
  sessionId: string,
  actionType: string,
  payload?: unknown,
) {
  const session = getSession(sessionId);
  if (!session || !env.DEBUG_MONITOR_ENABLED) {
    return;
  }

  session.actionsSent += 1;
  touchSession(session);

  pushEvent({
    type: 'action.sent',
    sessionId,
    userId: session.userId,
    projectId: session.projectId,
    detail: {
      actionType,
      payload: summarizeUnknown(payload),
    },
  });
}

export function recordGeminiMessage(
  sessionId: string,
  message: unknown,
  direction: 'incoming' | 'outgoing',
) {
  const session = getSession(sessionId);
  if (!session || !env.DEBUG_MONITOR_ENABLED) {
    return;
  }

  session.geminiMessages += 1;
  touchSession(session);

  pushEvent({
    type: 'gemini.message',
    sessionId,
    userId: session.userId,
    projectId: session.projectId,
    detail: {
      direction,
      message: summarizeUnknown(message),
    },
  });

  const texts = extractMessageTextParts(message);
  if (texts.length === 0) {
    return;
  }

  for (const text of texts) {
    const snippet = truncate(text, 420);
    session.generatedTextChars += text.length;
    session.generatedTextLast = snippet;

    pushEvent({
      type: 'response.text',
      sessionId,
      userId: session.userId,
      projectId: session.projectId,
      detail: {
        length: text.length,
        snippet,
      },
    });
  }
}

export function recordGeminiError(sessionId: string, message: string) {
  const session = getSession(sessionId);
  if (!session || !env.DEBUG_MONITOR_ENABLED) {
    return;
  }

  session.lastError = message;
  touchSession(session);

  pushEvent({
    type: 'gemini.error',
    sessionId,
    userId: session.userId,
    projectId: session.projectId,
    detail: {
      message: truncate(message, 420),
    },
  });
}

export function recordVoiceActivity(
  sessionId: string,
  voiceState: VoiceState,
  detail?: Record<string, unknown>,
) {
  const session = getSession(sessionId);
  if (!session || !env.DEBUG_MONITOR_ENABLED) {
    return;
  }

  const now = nowIso();
  session.voiceState = voiceState;
  session.lastVoiceActivityAt = now;
  touchSession(session);

  pushEvent({
    type: 'voice.activity',
    sessionId,
    userId: session.userId,
    projectId: session.projectId,
    detail: {
      voiceState,
      ...(detail ?? {}),
    },
  });
}

export function recordAgentStart(
  sessionId: string,
  agentName: string,
  args?: unknown,
) {
  const session = getSession(sessionId);
  if (!session || !env.DEBUG_MONITOR_ENABLED) {
    return;
  }

  session.activeAgentSet.add(agentName);
  touchSession(session);

  pushEvent({
    type: 'agent.start',
    sessionId,
    userId: session.userId,
    projectId: session.projectId,
    detail: {
      agentName,
      args: summarizeUnknown(args),
      activeAgents: [...session.activeAgentSet],
    },
  });
}

export function recordAgentEnd(
  sessionId: string,
  agentName: string,
  ok: boolean,
  result?: unknown,
) {
  const session = getSession(sessionId);
  if (!session || !env.DEBUG_MONITOR_ENABLED) {
    return;
  }

  session.activeAgentSet.delete(agentName);
  touchSession(session);

  pushEvent({
    type: 'agent.end',
    sessionId,
    userId: session.userId,
    projectId: session.projectId,
    detail: {
      agentName,
      ok,
      result: summarizeUnknown(result),
      activeAgents: [...session.activeAgentSet],
    },
  });
}

export function closeDebugSession(sessionId: string, reason: string) {
  const session = getSession(sessionId);
  if (!session || !env.DEBUG_MONITOR_ENABLED) {
    return;
  }

  session.status = 'closed';
  session.voiceState = 'idle';
  session.closedAt = nowIso();
  session.lastActivityAt = session.closedAt;
  session.activeAgentSet.clear();

  pushEvent({
    type: 'session.close',
    sessionId,
    userId: session.userId,
    projectId: session.projectId,
    detail: {
      reason,
      totals: {
        actionsReceived: session.actionsReceived,
        actionsSent: session.actionsSent,
        geminiMessages: session.geminiMessages,
        generatedTextChars: session.generatedTextChars,
      },
    },
  });
}

export function getDebugMonitorSnapshot() {
  const sessions = [...state.sessions.values()].map(toPublicSession);
  const activeSessions = sessions.filter(
    (session) => session.status === 'active',
  );

  return {
    enabled: env.DEBUG_MONITOR_ENABLED,
    provider: env.GEMINI_PROVIDER,
    model: env.GEMINI_LIVE_MODEL,
    totalSessions: sessions.length,
    activeSessions: activeSessions.length,
    activeAgents: activeSessions.flatMap((session) => session.activeAgents),
    sessions,
  };
}

export function getDebugMonitorEvents(limit = 100) {
  const safeLimit = Math.max(1, Math.min(limit, env.DEBUG_MONITOR_MAX_EVENTS));
  return state.events.slice(-safeLimit);
}
