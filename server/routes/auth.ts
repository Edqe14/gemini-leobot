import { Hono } from 'hono'
import { auth } from '../lib/auth'

export const authRouter = new Hono()

authRouter.on(['GET', 'POST'], '/api/auth/*', async (c) => {
  return auth.handler(c.req.raw)
})

authRouter.get('/api/me', async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })

  if (!session) {
    return c.json({ user: null }, 401)
  }

  return c.json({ user: session.user, session: session.session })
})
