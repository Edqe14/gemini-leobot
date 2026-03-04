import { Hono } from 'hono'
import { z } from 'zod'
import { getSessionFromHeaders } from '../lib/auth'
import { createProjectForUser, getProjectForUser, listProjectsForUser } from '../services/project-service'

const createProjectSchema = z.object({
  name: z.string().min(1).max(120),
})

export const projectsRouter = new Hono()

projectsRouter.get('/api/projects', async (c) => {
  const session = await getSessionFromHeaders(c.req.raw.headers)
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const projects = await listProjectsForUser(session.user.id)
  return c.json({ projects })
})

projectsRouter.post('/api/projects', async (c) => {
  const session = await getSessionFromHeaders(c.req.raw.headers)
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const body = await c.req.json()
  const data = createProjectSchema.parse(body)
  const project = await createProjectForUser(session.user.id, data.name)

  return c.json({ project })
})

projectsRouter.get('/api/projects/:projectId', async (c) => {
  const session = await getSessionFromHeaders(c.req.raw.headers)
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const projectId = c.req.param('projectId')
  const project = await getProjectForUser(session.user.id, projectId)

  if (!project) {
    return c.json({ error: 'Project not found' }, 404)
  }

  return c.json({ project })
})
