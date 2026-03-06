import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authRouter } from './routes/auth';
import { debugRouter } from './routes/debug';
import { projectsRouter } from './routes/projects';
import { storyRouter } from './routes/story';
import { env } from './lib/env';

export function createApp() {
  const app = new Hono();

  app.use(
    '*',
    cors({
      origin: [env.APP_BASE_URL],
      credentials: true,
      allowHeaders: ['Content-Type', 'Authorization'],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  );

  app.get('/api/health', (c) => c.json({ ok: true }));

  app.route('/', authRouter);
  app.route('/', debugRouter);
  app.route('/', projectsRouter);
  app.route('/', storyRouter);

  return app;
}
