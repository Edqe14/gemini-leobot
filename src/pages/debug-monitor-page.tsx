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

  const loadData = useCallback(
    async (background = false) => {
      if (background) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const [monitorResponse, eventsResponse] = await Promise.all([
          fetch('/api/debug/monitor', { credentials: 'include' }),
          fetch(`/api/debug/monitor/events?limit=${limit}`, {
            credentials: 'include',
          }),
        ]);

        if (!monitorResponse.ok) {
          throw new Error(
            `Monitor endpoint failed (${monitorResponse.status})`,
          );
        }

        if (!eventsResponse.ok) {
          throw new Error(`Events endpoint failed (${eventsResponse.status})`);
        }

        const monitorPayload = (await monitorResponse.json()) as {
          monitor: MonitorSnapshot;
        };
        const eventsPayload = (await eventsResponse.json()) as {
          events: MonitorEvent[];
        };

        setMonitor(monitorPayload.monitor);
        setEvents(eventsPayload.events);
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
    [limit],
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
            <div className='flex items-center gap-2 text-xs text-muted-foreground'>
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
            {events.map((event) => (
              <div
                key={event.id}
                className='rounded-lg border border-border p-3'>
                <div className='flex flex-wrap items-center gap-2'>
                  <Badge variant='outline'>{event.type}</Badge>
                  <span className='text-xs text-muted-foreground'>
                    {new Date(event.at).toLocaleTimeString()}
                  </span>
                  {event.sessionId ? (
                    <span className='text-xs text-muted-foreground'>
                      session: {event.sessionId}
                    </span>
                  ) : null}
                </div>
                <pre className='mt-2 overflow-x-auto whitespace-pre-wrap wrap-break-word text-xs text-muted-foreground'>
                  {JSON.stringify(event.detail, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
