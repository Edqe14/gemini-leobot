import { Hono } from 'hono'
import { z } from 'zod'
import { prisma } from '../lib/db'
import { getSessionFromHeaders } from '../lib/auth'
import { importGoogleDocAsMarkdown } from '../services/story-import'

const importSchema = z.object({
  sourceUrl: z.string().url(),
})

export const storyRouter = new Hono()

storyRouter.post('/api/projects/:projectId/story/import', async (c) => {
  const session = await getSessionFromHeaders(c.req.raw.headers)
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const projectId = c.req.param('projectId')
  const existingProject = await prisma.project.findFirst({
    where: { id: projectId, userId: session.user.id },
  })

  if (!existingProject) {
    return c.json({ error: 'Project not found' }, 404)
  }

  const existingStory = await prisma.story.findUnique({
    where: { projectId },
  })

  if (existingStory) {
    return c.json({ error: 'Project already has a story. Update flow not implemented yet.' }, 409)
  }

  const body = await c.req.json()
  const { sourceUrl } = importSchema.parse(body)
  const imported = await importGoogleDocAsMarkdown({ sourceUrl })

  const story = await prisma.story.create({
    data: {
      projectId,
      sourceDocUrl: imported.sourceDocUrl,
      title: imported.title,
      markdown: imported.markdown,
      backgroundPrompt: 'Auto-generated from story import.',
    },
  })

  return c.json({ story })
})
