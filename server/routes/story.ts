import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../lib/db';
import { getSessionFromHeaders } from '../lib/auth';
import { importGoogleDocAsMarkdown } from '../services/story-import';
import { allocateNodePositions } from '../services/node-position';
import {
  acceptStoryRewriteProposalForUser,
  createStoryRewriteProposalForUser,
  rejectStoryRewriteProposalForUser,
} from '../services/tools';

const importSchema = z.object({
  sourceUrl: z.string().url().optional(),
  markdown: z.string().min(1).optional(),
  title: z.string().min(1).max(160).optional(),
});

const rewriteProposalSchema = z.object({
  instruction: z.string().trim().min(1).max(4000),
  selectionText: z.string().trim().min(1).max(16000),
  selectionStart: z.coerce.number().int().min(0).optional(),
  selectionEnd: z.coerce.number().int().min(1).optional(),
});

export const storyRouter = new Hono();

async function requireProjectAccess(userId: string, projectId: string) {
  return prisma.project.findFirst({
    where: { id: projectId, userId },
    select: { id: true },
  });
}

storyRouter.post('/api/projects/:projectId/story/import', async (c) => {
  const session = await getSessionFromHeaders(c.req.raw.headers);
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const projectId = c.req.param('projectId');
  const existingProject = await prisma.project.findFirst({
    where: { id: projectId, userId: session.user.id },
  });

  if (!existingProject) {
    return c.json({ error: 'Project not found' }, 404);
  }

  const body = await c.req.json();
  const parsed = importSchema.parse(body);
  const sourceUrl = parsed.sourceUrl?.trim();
  const markdownInput = parsed.markdown?.trim();
  const titleInput = parsed.title?.trim();

  if (!sourceUrl && !markdownInput) {
    return c.json({ error: 'Provide either "sourceUrl" or "markdown".' }, 400);
  }

  let markdown = markdownInput ?? '';
  let title = titleInput ?? '';
  let sourceDocUrl: string | null = null;

  if (sourceUrl) {
    const imported = await importGoogleDocAsMarkdown({ sourceUrl });
    markdown = imported.markdown;
    title = titleInput || imported.title;
    sourceDocUrl = imported.sourceDocUrl;
  } else if (!title) {
    title =
      markdown
        .split('\n')
        .find((line) => line.trim().startsWith('# '))
        ?.replace('# ', '') || 'Imported Story';
  }

  const [createPosition] = await allocateNodePositions(projectId, 1);

  const story = await prisma.story.upsert({
    where: { projectId },
    update: {
      sourceDocUrl,
      title,
      markdown,
      importedAt: new Date(),
      backgroundPrompt: 'Auto-generated from story import.',
    },
    create: {
      positionX: createPosition?.x ?? 80,
      positionY: createPosition?.y ?? 120,
      projectId,
      sourceDocUrl,
      title,
      markdown,
      backgroundPrompt: 'Auto-generated from story import.',
    },
  });

  return c.json({
    story,
    mode: sourceUrl ? 'google_docs' : 'markdown',
  });
});

storyRouter.post(
  '/api/projects/:projectId/story/rewrite/proposals',
  async (c) => {
    const session = await getSessionFromHeaders(c.req.raw.headers);
    if (!session) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const projectId = c.req.param('projectId');
    const project = await requireProjectAccess(session.user.id, projectId);
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    const body = await c.req.json();
    const parsed = rewriteProposalSchema.parse(body);
    const result = await createStoryRewriteProposalForUser({
      userId: session.user.id,
      projectId,
      instruction: parsed.instruction,
      selectionText: parsed.selectionText,
      selectionStart: parsed.selectionStart,
      selectionEnd: parsed.selectionEnd,
      source: 'story_node',
    });

    if (!result.ok) {
      const statusCode = result.message === 'Project not found' ? 404 : 400;
      return c.json(
        {
          error: result.message,
          issues: 'issues' in result ? result.issues : undefined,
        },
        statusCode,
      );
    }

    return c.json({ ok: true, story: result.story, proposal: result.proposal });
  },
);

storyRouter.post('/api/projects/:projectId/story/rewrite/accept', async (c) => {
  const session = await getSessionFromHeaders(c.req.raw.headers);
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const projectId = c.req.param('projectId');
  const project = await requireProjectAccess(session.user.id, projectId);
  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  const result = await acceptStoryRewriteProposalForUser({
    userId: session.user.id,
    projectId,
  });

  if (!result.ok) {
    const statusCode =
      'stale' in result && result.stale
        ? 409
        : result.message === 'Project not found'
          ? 404
          : 400;
    return c.json(
      {
        error: result.message,
        stale: 'stale' in result ? result.stale : undefined,
      },
      statusCode,
    );
  }

  return c.json({
    ok: true,
    story: result.story,
    revisionCount: result.revisionCount,
  });
});

storyRouter.post('/api/projects/:projectId/story/rewrite/reject', async (c) => {
  const session = await getSessionFromHeaders(c.req.raw.headers);
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const projectId = c.req.param('projectId');
  const project = await requireProjectAccess(session.user.id, projectId);
  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  const result = await rejectStoryRewriteProposalForUser({
    userId: session.user.id,
    projectId,
  });

  if (!result.ok) {
    const statusCode = result.message === 'Project not found' ? 404 : 400;
    return c.json({ error: result.message }, statusCode);
  }

  return c.json({ ok: true, story: result.story });
});
