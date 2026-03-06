import { Hono } from 'hono';
import { getSessionFromHeaders } from '../lib/auth';
import { prisma } from '../lib/db';
import {
  getDebugMonitorEvents,
  getDebugMonitorSnapshot,
} from '../lib/debug-monitor';

export const debugRouter = new Hono();

function parseBooleanQuery(value: string | undefined, fallback = false) {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

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
  const importantOnly = parseBooleanQuery(c.req.query('importantOnly'), true);
  const includeAudioChunkEvents = parseBooleanQuery(
    c.req.query('includeAudioChunkEvents'),
    false,
  );

  return c.json({
    events: getDebugMonitorEvents(Number.isFinite(limit) ? limit : 100, {
      importantOnly,
      includeAudioChunkEvents,
    }),
  });
});

debugRouter.get('/api/debug/db-snapshot', async (c) => {
  const session = await getSessionFromHeaders(c.req.raw.headers);
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const [
    users,
    projects,
    stories,
    characterNodes,
    styleNodes,
    storyboardNodes,
    sessions,
    accounts,
    verifications,
  ] = await Promise.all([
    prisma.user.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
        emailVerified: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.project.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        userId: true,
        name: true,
        description: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.story.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        projectId: true,
        title: true,
        sourceDocUrl: true,
        markdown: true,
        importedAt: true,
        backgroundPrompt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.characterNode.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        projectId: true,
        name: true,
        briefMarkdown: true,
        inspirationPrompt: true,
        inspirationUrls: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.styleNode.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        projectId: true,
        name: true,
        description: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.storyboardNode.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        projectId: true,
        title: true,
        shotsJson: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.session.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.account.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        accountId: true,
        providerId: true,
        userId: true,
        scope: true,
        accessTokenExpiresAt: true,
        refreshTokenExpiresAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.verification.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        identifier: true,
        expiresAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);

  return c.json({
    snapshotAt: new Date().toISOString(),
    counts: {
      users: users.length,
      projects: projects.length,
      stories: stories.length,
      characterNodes: characterNodes.length,
      styleNodes: styleNodes.length,
      storyboardNodes: storyboardNodes.length,
      sessions: sessions.length,
      accounts: accounts.length,
      verifications: verifications.length,
    },
    objects: {
      users,
      projects,
      stories,
      characterNodes,
      styleNodes,
      storyboardNodes,
      sessions,
      accounts,
      verifications,
    },
  });
});
