# Leobot

Voice-controlled creative agent scaffold with:

- Vite + React frontend
- Hono API + WebSocket backend
- Prisma + MongoDB
- Better Auth + Google OAuth
- Gemini Live API relay
- shadcn/ui primitives
- React Flow canvas UI

## Architecture

- Browser UI connects to backend via `/ws` (proxied by Vite in dev)
- Hono backend authenticates session and relays realtime messages to Gemini Live
- Gemini tool calls are routed through an agent router and project services
- Prisma persists users, projects, story (one per project), character/style/storyboard nodes

## Quick Start

1. Install dependencies:

```bash
bun install
```

2. Copy env template:

```bash
cp .env.example .env
```

3. Configure:

- MongoDB `DATABASE_URL`
- Better Auth `BETTER_AUTH_SECRET`
- Google OAuth credentials
- Gemini API key

4. Generate Prisma client and push schema:

```bash
bun run prisma:generate
bun run prisma:push
```

5. Run app:

```bash
bun run dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8787`

## Google OAuth setup

Create OAuth credentials in Google Cloud Console and set:

- Authorized JavaScript origins: `http://localhost:5173`, `http://localhost:8787`
- Authorized redirect URI: `http://localhost:8787/api/auth/callback/google`

## Current API Surface

- `GET /api/health`
- `GET /api/me`
- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:projectId`
- `POST /api/projects/:projectId/story/import`
- `WS /ws`

## WebSocket Message Shapes (MVP)

Client -> Server:

- `{ type: "agent.context", payload: { projectId } }`
- `{ type: "gemini.clientContent", payload: { turns, turnComplete } }`
- `{ type: "gemini.realtimeInput", payload: { media: { mimeType, data } } }`

Server -> Client:

- `ws.ready`
- `gemini.server`
- `gemini.error`
- `gemini.closed`
- `agent.context.updated`

## Notes

- Story import enforces one story per project.
- Tool-call handlers are scaffolded and persist generated nodes.
- Mic UX currently toggles websocket-driven prompt mode; raw microphone streaming can be layered next with browser audio capture.
