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
- Gemini provider (`GEMINI_PROVIDER`) and matching credentials

### Gemini provider setup

This project uses `@google/genai` (Google GenAI SDK) and supports both SDK-style switching and project-style switching.

Set either:

- `GEMINI_PROVIDER` to one of:
  - `ai_studio`: uses `GEMINI_API_KEY`
  - `vertex`: uses Vertex AI with ADC (`GOOGLE_CLOUD_PROJECT` + `GOOGLE_CLOUD_LOCATION`)
- or `GOOGLE_GENAI_USE_VERTEXAI=True|False` (Google quickstart style)

If both are set, `GEMINI_PROVIDER` takes precedence and must not conflict with `GOOGLE_GENAI_USE_VERTEXAI`.

For Vertex AI local development, authenticate with ADC using one of:

- `gcloud auth application-default login`
- `GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json`

The server validates provider-specific env vars at startup.

### Debug monitoring

Enable realtime debug monitoring with:

- `DEBUG_MONITOR_ENABLED=true`
- `DEBUG_MONITOR_MAX_EVENTS=2000` (bounded in-memory event history)

When enabled, the server tracks websocket session lifecycle, active tool/agent calls, action send/receive events, Gemini errors, and generated response text snippets.

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
- `GET /api/debug/monitor`
- `GET /api/debug/monitor/events?limit=100`
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
