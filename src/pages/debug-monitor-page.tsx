import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthGate } from '@/components/auth-gate';

type MonitorSession = {
  id: string;
  userId: string;
  projectId?: string;
  provider: 'ai_studio' | 'vertex';
  model: string;
  status: 'active' | 'closed';
  voiceState: 'idle' | 'active';
  lastVoiceActivityAt?: string;
  openedAt: string;
  closedAt?: string;
  lastActivityAt: string;
  actionsReceived: number;
  actionsSent: number;
  geminiMessages: number;
  generatedTextChars: number;
  generatedTextLast?: string;
  activeAgents: string[];
  lastError?: string;
};

type MonitorSnapshot = {
  enabled: boolean;
  provider: 'ai_studio' | 'vertex';
  model: string;
  totalSessions: number;
  activeSessions: number;
  activeAgents: string[];
  sessions: MonitorSession[];
};

type MonitorEvent = {
  id: string;
  at: string;
  sessionId?: string;
  userId?: string;
  projectId?: string;
  type: string;
  detail: Record<string, unknown>;
};

type EventImageAttachment = {
  kind: 'image-inline';
  mimeType: string;
  dataUrl: string;
  bytesApprox?: number;
};

type DbSnapshotResponse = {
  snapshotAt: string;
  counts: Record<string, number>;
  objects: Record<string, unknown[]>;
};

function formatDateTime(value?: string) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function formatEventLabel(event: MonitorEvent) {
  if (event.type === 'action.sent' || event.type === 'action.received') {
    const actionType = event.detail.actionType;
    if (typeof actionType === 'string' && actionType) {
      return `${event.type}: ${actionType}`;
    }
  }

  if (event.type === 'agent.start' || event.type === 'agent.end') {
    const agentName = event.detail.agentName;
    if (typeof agentName === 'string' && agentName) {
      return `${event.type}: ${agentName}`;
    }
  }

  return event.type;
}

function isErrorLikeEvent(event: MonitorEvent) {
  if (event.type === 'gemini.error') {
    return true;
  }

  const actionType = event.detail.actionType;
  return typeof actionType === 'string' && actionType.includes('error');
}

function getEventImageAttachments(event: MonitorEvent) {
  const raw = event.detail.attachments;
  if (!Array.isArray(raw)) {
    return [] as EventImageAttachment[];
  }

  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }

      const record = item as Record<string, unknown>;
      const kind =
        typeof record.kind === 'string' ? record.kind.trim() : 'image-inline';
      const mimeType =
        typeof record.mimeType === 'string' ? record.mimeType.trim() : '';
      const dataUrl =
        typeof record.dataUrl === 'string' ? record.dataUrl.trim() : '';
      const bytesApprox =
        typeof record.bytesApprox === 'number' ? record.bytesApprox : undefined;

      if (
        kind !== 'image-inline' ||
        !mimeType.startsWith('image/') ||
        !dataUrl
      ) {
        return null;
      }

      return {
        kind: 'image-inline',
        mimeType,
        dataUrl,
        ...(typeof bytesApprox === 'number' ? { bytesApprox } : {}),
      } satisfies EventImageAttachment;
    })
    .filter((item): item is EventImageAttachment => Boolean(item));
}

export function DebugMonitorPage() {
  return <AuthGate>{() => <DebugMonitorView />}</AuthGate>;
}

function DebugMonitorView() {
  const navigate = useNavigate();
  const [monitor, setMonitor] = useState<MonitorSnapshot | null>(null);
  const [events, setEvents] = useState<MonitorEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [limit, setLimit] = useState(120);
  const [importantOnly, setImportantOnly] = useState(true);
  const [includeAudioNoise, setIncludeAudioNoise] = useState(false);
  const [dbSnapshot, setDbSnapshot] = useState<DbSnapshotResponse | null>(null);
  const [activeDbCollection, setActiveDbCollection] = useState('projects');

  const loadData = useCallback(
    async (background = false) => {
      if (background) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const eventUrl = new URL(
          '/api/debug/monitor/events',
          window.location.origin,
        );
        eventUrl.searchParams.set('limit', String(limit));
        eventUrl.searchParams.set('importantOnly', importantOnly ? '1' : '0');
        eventUrl.searchParams.set(
          'includeAudioChunkEvents',
          includeAudioNoise ? '1' : '0',
        );

        const [monitorResponse, eventsResponse, dbResponse] = await Promise.all(
          [
            fetch('/api/debug/monitor', { credentials: 'include' }),
            fetch(eventUrl.toString(), {
              credentials: 'include',
            }),
            fetch('/api/debug/db-snapshot', {
              credentials: 'include',
            }),
          ],
        );

        if (!monitorResponse.ok) {
          throw new Error(
            `Monitor endpoint failed (${monitorResponse.status})`,
          );
        }

        if (!eventsResponse.ok) {
          throw new Error(`Events endpoint failed (${eventsResponse.status})`);
        }

        if (!dbResponse.ok) {
          throw new Error(`DB endpoint failed (${dbResponse.status})`);
        }

        const monitorPayload = (await monitorResponse.json()) as {
          monitor: MonitorSnapshot;
        };
        const eventsPayload = (await eventsResponse.json()) as {
          events: MonitorEvent[];
        };
        const dbPayload = (await dbResponse.json()) as DbSnapshotResponse;

        setMonitor(monitorPayload.monitor);
        setEvents(eventsPayload.events);
        setDbSnapshot(dbPayload);
        setError('');
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Failed to load debug monitor data.',
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [includeAudioNoise, importantOnly, limit],
  );

  useEffect(() => {
    void loadData(false);
  }, [loadData]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadData(true);
    }, 3000);

    return () => {
      window.clearInterval(timer);
    };
  }, [loadData]);

  const totals = useMemo(() => {
    const activeAgentCount = monitor?.activeAgents.length ?? 0;
    const generatedTextChars =
      monitor?.sessions.reduce(
        (acc, item) => acc + item.generatedTextChars,
        0,
      ) ?? 0;

    return {
      activeAgentCount,
      generatedTextChars,
    };
  }, [monitor]);

  const dbCollectionNames = useMemo(() => {
    return Object.keys(dbSnapshot?.objects ?? {});
  }, [dbSnapshot]);

  const activeDbRows = useMemo(() => {
    const collections = dbSnapshot?.objects;
    if (!collections) {
      return [];
    }

    return collections[activeDbCollection] ?? [];
  }, [activeDbCollection, dbSnapshot]);

  const sortedEvents = useMemo(() => {
    return [...events].sort((a, b) => {
      const aTime = new Date(a.at).getTime();
      const bTime = new Date(b.at).getTime();

      if (Number.isNaN(aTime) && Number.isNaN(bTime)) {
        return 0;
      }

      if (Number.isNaN(aTime)) {
        return 1;
      }

      if (Number.isNaN(bTime)) {
        return -1;
      }

      return bTime - aTime;
    });
  }, [events]);

  useEffect(() => {
    if (!dbCollectionNames.length) {
      return;
    }

    if (!dbCollectionNames.includes(activeDbCollection)) {
      setActiveDbCollection(dbCollectionNames[0]);
    }
  }, [activeDbCollection, dbCollectionNames]);

  if (loading && !monitor) {
    return (
      <div className='flex h-screen w-screen items-center justify-center bg-background p-6 text-foreground'>
        <div className='rounded-2xl border-2 border-black bg-[#FFE234] px-8 py-6 shadow-[5px_5px_0_#1A1A1A]'>
          <p className='text-base font-bold uppercase tracking-widest'>
            Loading debug monitor...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className='min-h-screen w-full bg-background p-6 text-foreground'>
      <div className='mx-auto w-full max-w-6xl space-y-5'>
        {/* ── Top bar ── */}
        <div className='flex items-center justify-between gap-4'>
          <div className='flex items-center gap-3'>
            <div className='rounded-xl border-2 border-black bg-[#FFE234] px-4 py-2 shadow-[3px_3px_0_#1A1A1A]'>
              <span className='text-sm font-black uppercase tracking-widest'>
                Debug Monitor
              </span>
            </div>
            <div
              className={`rounded-lg border-2 border-black px-3 py-1.5 text-xs font-bold uppercase tracking-wide shadow-[2px_2px_0_#1A1A1A] ${monitor?.enabled ? 'bg-[#CCFF00]' : 'bg-[#EDEAD9]'}`}>
              {monitor?.enabled ? 'enabled' : 'disabled'}
            </div>
            {refreshing ? (
              <div className='rounded-lg border-2 border-black bg-[#4ECDC4] px-3 py-1.5 text-xs font-bold uppercase tracking-wide shadow-[2px_2px_0_#1A1A1A]'>
                refreshing
              </div>
            ) : null}
          </div>

          <div className='flex items-center gap-2'>
            <button
              type='button'
              className='brut-shadow-hover rounded-xl border-2 border-black bg-white px-4 py-2 text-sm font-bold uppercase tracking-wide shadow-[3px_3px_0_#1A1A1A] hover:bg-[#EDEAD9]'
              onClick={() => navigate('/')}>
              ← Canvas
            </button>
            <button
              type='button'
              className='brut-shadow-hover rounded-xl border-2 border-black bg-[#1A1A1A] px-4 py-2 text-sm font-bold uppercase tracking-wide text-[#FFE234] shadow-[3px_3px_0_#4A4A4A]'
              onClick={() => void loadData(true)}>
              Refresh ↺
            </button>
          </div>
        </div>

        {/* ── Error banner ── */}
        {error ? (
          <div className='rounded-xl border-2 border-black bg-[#FF6B6B] px-5 py-4 shadow-[3px_3px_0_#1A1A1A]'>
            <p className='text-sm font-bold'>Failed to load monitor</p>
            <p className='mt-1 font-mono text-xs'>{error}</p>
          </div>
        ) : null}

        {/* ── 4 stat cards ── */}
        <div className='grid grid-cols-1 gap-4 md:grid-cols-4'>
          <div className='rounded-xl border-2 border-black bg-[#FFE234] p-4 shadow-[4px_4px_0_#1A1A1A]'>
            <p className='text-xs font-bold uppercase tracking-widest text-black/60'>
              Provider
            </p>
            <p className='mt-1 text-2xl font-black'>
              {monitor?.provider ?? '—'}
            </p>
          </div>
          <div className='rounded-xl border-2 border-black bg-[#FF6B6B] p-4 shadow-[4px_4px_0_#1A1A1A]'>
            <p className='text-xs font-bold uppercase tracking-widest text-black/60'>
              Active Sessions
            </p>
            <p className='mt-1 text-2xl font-black'>
              {monitor?.activeSessions ?? 0}{' '}
              <span className='text-base font-bold text-black/50'>
                / {monitor?.totalSessions ?? 0}
              </span>
            </p>
          </div>
          <div className='rounded-xl border-2 border-black bg-[#4ECDC4] p-4 shadow-[4px_4px_0_#1A1A1A]'>
            <p className='text-xs font-bold uppercase tracking-widest text-black/60'>
              Active Agents
            </p>
            <p className='mt-1 text-2xl font-black'>
              {totals.activeAgentCount}
            </p>
          </div>
          <div className='rounded-xl border-2 border-black bg-[#CCFF00] p-4 shadow-[4px_4px_0_#1A1A1A]'>
            <p className='text-xs font-bold uppercase tracking-widest text-black/60'>
              Generated Chars
            </p>
            <p className='mt-1 text-2xl font-black'>
              {totals.generatedTextChars.toLocaleString()}
            </p>
          </div>
        </div>

        {/* ── Sessions ── */}
        <div className='rounded-2xl border-2 border-black bg-white shadow-[4px_4px_0_#1A1A1A]'>
          <div className='flex items-center justify-between border-b-2 border-black px-5 py-3'>
            <p className='text-sm font-black uppercase tracking-widest'>
              Sessions
            </p>
            <p className='font-mono text-xs text-muted-foreground'>
              model: {monitor?.model ?? '—'}
            </p>
          </div>
          <div className='space-y-2 p-4'>
            {(monitor?.sessions ?? []).length === 0 ? (
              <p className='font-mono text-xs text-muted-foreground'>
                no sessions
              </p>
            ) : null}
            {(monitor?.sessions ?? []).map((session) => (
              <div
                key={session.id}
                className={`rounded-xl border-2 border-black p-3 ${session.status === 'active' ? 'bg-[#CCFF00]/30' : 'bg-[#EDEAD9]'}`}>
                <div className='flex flex-wrap items-center gap-2'>
                  <span
                    className={`rounded-md border-2 border-black px-2 py-0.5 text-xs font-bold uppercase ${session.status === 'active' ? 'bg-[#CCFF00]' : 'bg-white'}`}>
                    {session.status}
                  </span>
                  <span className='rounded-md border border-black/40 bg-white px-2 py-0.5 font-mono text-xs'>
                    voice: {session.voiceState}
                  </span>
                  <span className='font-mono text-xs text-muted-foreground'>
                    {session.id}
                  </span>
                  <span className='font-mono text-xs text-muted-foreground'>
                    user: {session.userId}
                  </span>
                  <span className='font-mono text-xs text-muted-foreground'>
                    project: {session.projectId ?? 'none'}
                  </span>
                </div>
                <p className='mt-2 font-mono text-xs text-muted-foreground'>
                  recv: {session.actionsReceived} • sent: {session.actionsSent}{' '}
                  • gemini: {session.geminiMessages} • chars:{' '}
                  {session.generatedTextChars}
                </p>
                {session.lastVoiceActivityAt ? (
                  <p className='mt-1 font-mono text-xs text-muted-foreground'>
                    voice:{' '}
                    {new Date(session.lastVoiceActivityAt).toLocaleTimeString()}
                  </p>
                ) : null}
                {session.activeAgents.length ? (
                  <p className='mt-1 font-mono text-xs text-muted-foreground'>
                    agents: {session.activeAgents.join(', ')}
                  </p>
                ) : null}
                {session.generatedTextLast ? (
                  <p className='mt-1 line-clamp-2 font-mono text-xs text-muted-foreground'>
                    ↳ {session.generatedTextLast}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        {/* ── Recent Events ── */}
        <div className='rounded-2xl border-2 border-black bg-white shadow-[4px_4px_0_#1A1A1A]'>
          <div className='flex flex-wrap items-center justify-between gap-3 border-b-2 border-black px-5 py-3'>
            <p className='text-sm font-black uppercase tracking-widest'>
              Recent Events
            </p>
            <div className='flex flex-wrap items-center gap-4 font-mono text-xs text-muted-foreground'>
              <label className='flex cursor-pointer items-center gap-1.5'>
                <input
                  type='checkbox'
                  checked={importantOnly}
                  onChange={(event) => setImportantOnly(event.target.checked)}
                  className='accent-[#1A1A1A]'
                />
                important only
              </label>
              <label className='flex cursor-pointer items-center gap-1.5'>
                <input
                  type='checkbox'
                  checked={includeAudioNoise}
                  onChange={(event) =>
                    setIncludeAudioNoise(event.target.checked)
                  }
                  className='accent-[#1A1A1A]'
                />
                audio noise
              </label>
              <label htmlFor='eventLimit'>limit</label>
              <select
                id='eventLimit'
                className='rounded-md border-2 border-black bg-[#EDEAD9] px-2 py-1 font-mono text-xs'
                value={limit}
                onChange={(event) => setLimit(Number(event.target.value))}>
                <option value={50}>50</option>
                <option value={120}>120</option>
                <option value={300}>300</option>
              </select>
            </div>
          </div>

          <div className='max-h-[45vh] space-y-2 overflow-auto p-4'>
            {sortedEvents.length === 0 ? (
              <p className='font-mono text-xs text-muted-foreground'>
                No events in current filter.
              </p>
            ) : null}

            {sortedEvents.map((event) => (
              <div
                key={event.id}
                className={`rounded-xl border-2 border-black p-3 ${isErrorLikeEvent(event) ? 'bg-[#FF6B6B]/20' : 'bg-[#F7F4EC]'}`}>
                <div className='flex flex-wrap items-center gap-2'>
                  <span
                    className={`rounded-md border-2 border-black px-2 py-0.5 font-mono text-xs font-bold ${isErrorLikeEvent(event) ? 'bg-[#FF6B6B] text-black' : 'bg-[#FFE234]'}`}>
                    {formatEventLabel(event)}
                  </span>
                  <span className='font-mono text-xs text-muted-foreground'>
                    {formatDateTime(event.at)}
                  </span>
                  {event.sessionId ? (
                    <span className='font-mono text-xs text-muted-foreground'>
                      session: {event.sessionId}
                    </span>
                  ) : null}
                </div>
                {(() => {
                  const attachments = getEventImageAttachments(event);
                  if (!attachments.length) {
                    return null;
                  }

                  return (
                    <div className='mt-2'>
                      <p className='mb-2 font-mono text-xs text-muted-foreground'>
                        attachments ({attachments.length})
                      </p>
                      <div className='grid grid-cols-1 gap-2 md:grid-cols-2'>
                        {attachments.map((attachment, index) => (
                          <div
                            key={`${event.id}-img-${index}`}
                            className='rounded-lg border-2 border-black bg-[#EDEAD9] p-2'>
                            <img
                              src={attachment.dataUrl}
                              alt={`Debug attachment ${index + 1}`}
                              className='max-h-56 w-full rounded-md object-contain'
                            />
                            <p className='mt-1 font-mono text-[11px] text-muted-foreground'>
                              {attachment.mimeType}
                              {typeof attachment.bytesApprox === 'number'
                                ? ` • ~${attachment.bytesApprox} bytes`
                                : ''}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
                <details className='mt-2'>
                  <summary className='cursor-pointer font-mono text-xs text-muted-foreground hover:text-foreground'>
                    ▸ show detail
                  </summary>
                  <pre className='mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-black/20 bg-[#1A1A1A] p-3 font-mono text-xs text-[#CCFF00]'>
                    {JSON.stringify(event.detail, null, 2)}
                  </pre>
                </details>
              </div>
            ))}
          </div>
        </div>

        {/* ── Database Snapshot ── */}
        <div className='rounded-2xl border-2 border-black bg-white shadow-[4px_4px_0_#1A1A1A]'>
          <div className='flex items-center justify-between border-b-2 border-black px-5 py-3'>
            <p className='text-sm font-black uppercase tracking-widest'>
              Database Snapshot
            </p>
            <p className='font-mono text-xs text-muted-foreground'>
              refreshed: {formatDateTime(dbSnapshot?.snapshotAt)}
            </p>
          </div>

          <div className='p-4'>
            <div className='grid grid-cols-2 gap-2 md:grid-cols-5'>
              {Object.entries(dbSnapshot?.counts ?? {}).map(
                ([name, count], i) => {
                  const colors = [
                    'bg-[#FFE234]',
                    'bg-[#4ECDC4]',
                    'bg-[#FF6B6B]',
                    'bg-[#CCFF00]',
                    'bg-[#C084FC]',
                  ];
                  const bg = colors[i % colors.length];
                  return (
                    <div
                      key={name}
                      className={`rounded-xl border-2 border-black p-2.5 shadow-[2px_2px_0_#1A1A1A] ${bg}`}>
                      <p className='font-mono text-xs font-bold text-black/60'>
                        {name}
                      </p>
                      <p className='text-lg font-black'>{count}</p>
                    </div>
                  );
                },
              )}
            </div>

            <div className='mt-4 flex flex-wrap items-center gap-3 font-mono text-xs'>
              <label
                htmlFor='dbCollection'
                className='font-bold text-muted-foreground'>
                collection
              </label>
              <select
                id='dbCollection'
                className='rounded-lg border-2 border-black bg-[#EDEAD9] px-2 py-1 font-mono text-xs'
                value={activeDbCollection}
                onChange={(event) => setActiveDbCollection(event.target.value)}>
                {dbCollectionNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <span className='text-muted-foreground'>
                rows: {activeDbRows.length}
              </span>
            </div>

            <div className='mt-3 max-h-[45vh] overflow-auto rounded-xl border-2 border-black bg-[#1A1A1A] p-4'>
              <pre className='whitespace-pre-wrap break-words font-mono text-xs text-[#CCFF00]'>
                {JSON.stringify(activeDbRows, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
