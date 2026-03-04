import { Hono } from 'hono';
import { getSessionFromHeaders } from '../lib/auth';
import {
  getDebugMonitorEvents,
  getDebugMonitorSnapshot,
} from '../lib/debug-monitor';

export const debugRouter = new Hono();

debugRouter.get('/api/debug/monitor', async (c) => {
  const session = await getSessionFromHeaders(c.req.raw.headers);
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  return c.json({ monitor: getDebugMonitorSnapshot() });
});

debugRouter.get('/api/debug/monitor/events', async (c) => {
  const session = await getSessionFromHeaders(c.req.raw.headers);
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const limitRaw = c.req.query('limit');
  const limit = limitRaw ? Number(limitRaw) : 100;

  return c.json({
    events: getDebugMonitorEvents(Number.isFinite(limit) ? limit : 100),
  });
});
