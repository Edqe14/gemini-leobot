import { Hono } from 'hono';
import { z } from 'zod';
import { getSessionFromHeaders } from '../lib/auth';
import { prisma } from '../lib/db';
import {
  createProjectForUser,
  getProjectForUser,
  listProjectsForUser,
} from '../services/project-service';

const createProjectSchema = z.object({
  name: z.string().min(1).max(120),
});

export const projectsRouter = new Hono();

async function requireProjectAccess(userId: string, projectId: string) {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      userId,
    },
    select: {
      id: true,
    },
  });

  return project;
}

projectsRouter.get('/api/projects', async (c) => {
  const session = await getSessionFromHeaders(c.req.raw.headers);
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const projects = await listProjectsForUser(session.user.id);
  return c.json({ projects });
});

projectsRouter.post('/api/projects', async (c) => {
  const session = await getSessionFromHeaders(c.req.raw.headers);
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const body = await c.req.json();
  const data = createProjectSchema.parse(body);
  const project = await createProjectForUser(session.user.id, data.name);

  return c.json({ project });
});

projectsRouter.get('/api/projects/:projectId', async (c) => {
  const session = await getSessionFromHeaders(c.req.raw.headers);
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const projectId = c.req.param('projectId');
  const project = await getProjectForUser(session.user.id, projectId);

  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  return c.json({ project });
});

projectsRouter.delete('/api/projects/:projectId/story', async (c) => {
  const session = await getSessionFromHeaders(c.req.raw.headers);
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const projectId = c.req.param('projectId');
  const project = await requireProjectAccess(session.user.id, projectId);
  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  const deleted = await prisma.story.deleteMany({
    where: { projectId },
  });

  return c.json({ ok: true, nodeType: 'story', deletedCount: deleted.count });
});

projectsRouter.delete(
  '/api/projects/:projectId/character-nodes/:nodeId',
  async (c) => {
    const session = await getSessionFromHeaders(c.req.raw.headers);
    if (!session) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const projectId = c.req.param('projectId');
    const nodeId = c.req.param('nodeId');
    const project = await requireProjectAccess(session.user.id, projectId);
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    const deleted = await prisma.characterNode.deleteMany({
      where: {
        id: nodeId,
        projectId,
      },
    });

    return c.json({
      ok: true,
      nodeType: 'character',
      deletedCount: deleted.count,
    });
  },
);

projectsRouter.delete(
  '/api/projects/:projectId/style-nodes/:nodeId',
  async (c) => {
    const session = await getSessionFromHeaders(c.req.raw.headers);
    if (!session) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const projectId = c.req.param('projectId');
    const nodeId = c.req.param('nodeId');
    const project = await requireProjectAccess(session.user.id, projectId);
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    const deleted = await prisma.styleNode.deleteMany({
      where: {
        id: nodeId,
        projectId,
      },
    });

    return c.json({ ok: true, nodeType: 'style', deletedCount: deleted.count });
  },
);

projectsRouter.delete(
  '/api/projects/:projectId/storyboard-nodes/:nodeId',
  async (c) => {
    const session = await getSessionFromHeaders(c.req.raw.headers);
    if (!session) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const projectId = c.req.param('projectId');
    const nodeId = c.req.param('nodeId');
    const project = await requireProjectAccess(session.user.id, projectId);
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    const deleted = await prisma.storyboardNode.deleteMany({
      where: {
        id: nodeId,
        projectId,
      },
    });

    return c.json({
      ok: true,
      nodeType: 'storyboard',
      deletedCount: deleted.count,
    });
  },
);
