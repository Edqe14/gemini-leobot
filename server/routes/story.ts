import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../lib/db';
import { getSessionFromHeaders } from '../lib/auth';
import { importGoogleDocAsMarkdown } from '../services/story-import';
import { allocateNodePositions } from '../services/node-position';

const importSchema = z.object({
  sourceUrl: z.string().url().optional(),
  markdown: z.string().min(1).optional(),
  title: z.string().min(1).max(160).optional(),
});

export const storyRouter = new Hono();

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
