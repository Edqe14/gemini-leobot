import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthGate } from '@/components/auth-gate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

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
        <Card className='p-6'>
          <p className='text-sm font-medium'>Loading debug monitor...</p>
        </Card>
      </div>
    );
  }

  return (
    <div className='min-h-screen w-full bg-background p-6 text-foreground'>
      <div className='mx-auto w-full max-w-6xl space-y-4'>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <Badge variant='outline'>Debug Monitor</Badge>
            <Badge variant='outline'>
              {monitor?.enabled ? 'enabled' : 'disabled'}
            </Badge>
            {refreshing ? <Badge variant='outline'>refreshing</Badge> : null}
          </div>

          <div className='flex items-center gap-2'>
            <Button variant='outline' onClick={() => navigate('/')}>
              Back to Canvas
            </Button>
            <Button onClick={() => void loadData(true)}>Refresh</Button>
          </div>
        </div>

        {error ? (
          <Card className='p-4'>
            <p className='text-sm font-medium'>Failed to load monitor</p>
            <p className='mt-1 text-xs text-muted-foreground'>{error}</p>
          </Card>
        ) : null}

        <div className='grid grid-cols-1 gap-3 md:grid-cols-4'>
          <Card className='p-4'>
            <p className='text-xs text-muted-foreground'>Provider</p>
            <p className='mt-1 text-sm font-medium'>
              {monitor?.provider ?? '-'}
            </p>
          </Card>
          <Card className='p-4'>
            <p className='text-xs text-muted-foreground'>Active Sessions</p>
            <p className='mt-1 text-sm font-medium'>
              {monitor?.activeSessions ?? 0} / {monitor?.totalSessions ?? 0}
            </p>
          </Card>
          <Card className='p-4'>
            <p className='text-xs text-muted-foreground'>Active Agents</p>
            <p className='mt-1 text-sm font-medium'>
              {totals.activeAgentCount}
            </p>
          </Card>
          <Card className='p-4'>
            <p className='text-xs text-muted-foreground'>
              Generated Text Chars
            </p>
            <p className='mt-1 text-sm font-medium'>
              {totals.generatedTextChars}
            </p>
          </Card>
        </div>

        <Card className='p-4'>
          <div className='flex items-center justify-between'>
            <p className='text-sm font-medium'>Sessions</p>
            <p className='text-xs text-muted-foreground'>
              model: {monitor?.model ?? '-'}
            </p>
          </div>
          <div className='mt-3 space-y-2'>
            {(monitor?.sessions ?? []).map((session) => (
              <div
                key={session.id}
                className='rounded-lg border border-border bg-card p-3'>
                <div className='flex flex-wrap items-center gap-2'>
                  <Badge variant='outline'>{session.status}</Badge>
                  <Badge variant='outline'>voice: {session.voiceState}</Badge>
                  <Badge variant='outline'>{session.id}</Badge>
                  <span className='text-xs text-muted-foreground'>
                    user: {session.userId}
                  </span>
                  <span className='text-xs text-muted-foreground'>
                    project: {session.projectId ?? 'none'}
                  </span>
                </div>
                <p className='mt-2 text-xs text-muted-foreground'>
                  recv: {session.actionsReceived} • sent: {session.actionsSent}{' '}
                  • gemini: {session.geminiMessages} • text chars:{' '}
                  {session.generatedTextChars}
                </p>
                {session.lastVoiceActivityAt ? (
                  <p className='mt-1 text-xs text-muted-foreground'>
                    last voice activity:{' '}
                    {new Date(session.lastVoiceActivityAt).toLocaleTimeString()}
                  </p>
                ) : null}
                {session.activeAgents.length ? (
                  <p className='mt-1 text-xs text-muted-foreground'>
                    agents: {session.activeAgents.join(', ')}
                  </p>
                ) : null}
                {session.generatedTextLast ? (
                  <p className='mt-1 line-clamp-2 text-xs text-muted-foreground'>
                    last text: {session.generatedTextLast}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </Card>

        <Card className='p-4'>
          <div className='flex items-center justify-between'>
            <p className='text-sm font-medium'>Recent Events</p>
            <div className='flex flex-wrap items-center gap-3 text-xs text-muted-foreground'>
              <label className='flex items-center gap-1'>
                <input
                  type='checkbox'
                  checked={importantOnly}
                  onChange={(event) => setImportantOnly(event.target.checked)}
                />
                important only
              </label>
              <label className='flex items-center gap-1'>
                <input
                  type='checkbox'
                  checked={includeAudioNoise}
                  onChange={(event) =>
                    setIncludeAudioNoise(event.target.checked)
                  }
                />
                include audio chunk noise
              </label>
              <label htmlFor='eventLimit'>limit</label>
              <select
                id='eventLimit'
                className='rounded border border-border bg-background px-2 py-1'
                value={limit}
                onChange={(event) => setLimit(Number(event.target.value))}>
                <option value={50}>50</option>
                <option value={120}>120</option>
                <option value={300}>300</option>
              </select>
            </div>
          </div>

          <div className='mt-3 max-h-[45vh] space-y-2 overflow-auto'>
            {sortedEvents.length === 0 ? (
              <p className='text-xs text-muted-foreground'>
                No events in the current filter.
              </p>
            ) : null}

            {sortedEvents.map((event) => (
              <div
                key={event.id}
                className='rounded-lg border border-border p-3'>
                <div className='flex flex-wrap items-center gap-2'>
                  <Badge
                    variant='outline'
                    className={
                      isErrorLikeEvent(event)
                        ? 'border-red-500/50 text-red-600'
                        : undefined
                    }>
                    {formatEventLabel(event)}
                  </Badge>
                  <span className='text-xs text-muted-foreground'>
                    {formatDateTime(event.at)}
                  </span>
                  {event.sessionId ? (
                    <span className='text-xs text-muted-foreground'>
                      session: {event.sessionId}
                    </span>
                  ) : null}
                </div>
                <details className='mt-2'>
                  <summary className='cursor-pointer text-xs text-muted-foreground'>
                    show detail
                  </summary>
                  <pre className='mt-2 overflow-x-auto whitespace-pre-wrap wrap-break-word rounded bg-muted p-2 text-xs text-muted-foreground'>
                    {JSON.stringify(event.detail, null, 2)}
                  </pre>
                </details>
              </div>
            ))}
          </div>
        </Card>

        <Card className='p-4'>
          <div className='flex items-center justify-between'>
            <p className='text-sm font-medium'>Database Snapshot</p>
            <p className='text-xs text-muted-foreground'>
              refreshed: {formatDateTime(dbSnapshot?.snapshotAt)}
            </p>
          </div>

          <div className='mt-3 grid grid-cols-2 gap-2 md:grid-cols-5'>
            {Object.entries(dbSnapshot?.counts ?? {}).map(([name, count]) => (
              <div
                key={name}
                className='rounded border border-border bg-card p-2'>
                <p className='text-xs text-muted-foreground'>{name}</p>
                <p className='text-sm font-medium'>{count}</p>
              </div>
            ))}
          </div>

          <div className='mt-3 flex flex-wrap items-center gap-2 text-xs'>
            <label htmlFor='dbCollection' className='text-muted-foreground'>
              collection
            </label>
            <select
              id='dbCollection'
              className='rounded border border-border bg-background px-2 py-1'
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

          <div className='mt-3 max-h-[45vh] overflow-auto rounded border border-border bg-muted p-3'>
            <pre className='whitespace-pre-wrap wrap-break-word text-xs text-muted-foreground'>
              {JSON.stringify(activeDbRows, null, 2)}
            </pre>
          </div>
        </Card>
      </div>
    </div>
  );
}
