# Leobot

Leobot is a voice-controlled creative agent for building storyboard projects. You speak to it in the browser and it helps you draft stories, develop characters with AI-generated design concepts, set style guides, and produce storyboard frames — all persisted on a React Flow canvas.

## How it works

- The browser connects to the backend over WebSocket (`/ws`)
- The backend authenticates the session, then opens a Gemini Live connection on behalf of the user
- Voice and text input flow through the Gemini Live bridge; tool calls from the model are routed through an agent system (home agent, project agent)
- Projects, stories, characters, style guides, and storyboard nodes are persisted in MongoDB via Prisma

## Prerequisites

- [Bun](https://bun.sh) v1.x
- A MongoDB database (Atlas free tier works fine)
- A Google Cloud project with OAuth 2.0 credentials
- A Gemini API key (AI Studio) **or** a Vertex AI project with ADC configured
- Optional: [Pexels](https://www.pexels.com/api/) and [Pixabay](https://pixabay.com/api/docs/) API keys for image reference search

## Setup

### 1. Install dependencies

```bash
bun install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in the following sections:

**App URLs** — leave as-is for local dev:

```
APP_BASE_URL=http://localhost:5173
API_BASE_URL=http://localhost:8787
```

**Database:**

```
DATABASE_URL=mongodb+srv://<username>:<password>@<cluster>/<db>?retryWrites=true&w=majority
```

**Auth:**

```
BETTER_AUTH_SECRET=<generate a long random string, e.g. openssl rand -base64 32>
GOOGLE_CLIENT_ID=<from Google Cloud Console>
GOOGLE_CLIENT_SECRET=<from Google Cloud Console>
```

**Gemini — pick one provider:**

Option A — Google AI Studio (simplest):

```
GEMINI_PROVIDER=ai_studio
GEMINI_API_KEY=<your key from aistudio.google.com>
```

Option B — Vertex AI:

```
GEMINI_PROVIDER=vertex
GOOGLE_CLOUD_PROJECT=<your GCP project ID>
GOOGLE_CLOUD_LOCATION=us-central1
```

For local Vertex AI auth, run `gcloud auth application-default login` or set `GOOGLE_APPLICATION_CREDENTIALS` to a service account key file.

**Models** (defaults shown, override if needed):

```
GEMINI_LIVE_MODEL=gemini-live-2.5-flash-preview
GEMINI_CHARACTER_SUBAGENT_MODEL=gemini-2.5-flash
GEMINI_STORYBOARD_SUBAGENT_MODEL=gemini-2.5-flash
GEMINI_STORYBOARD_IMAGE_MODEL=gemini-2.5-flash-image
GEMINI_CHARACTER_DESIGN_IMAGE_MODEL=imagen-4.0-generate-001
```

**Optional — image reference search:**

```
PEXELS_API_KEY=<your key>
PIXABAY_API_KEY=<your key>
```

### 3. Set up Google OAuth

In [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials, create an OAuth 2.0 Client ID (Web application) with:

- **Authorized JavaScript origins:** `http://localhost:5173`, `http://localhost:8787`
- **Authorized redirect URI:** `http://localhost:8787/api/auth/callback/google`

### 4. Initialize the database

```bash
bun run prisma:generate   # generate the Prisma client
bun run prisma:push       # push the schema to MongoDB
```

### 5. Run the app

```bash
bun run dev
```

| Service  | URL                   |
| -------- | --------------------- |
| Frontend | http://localhost:5173 |
| Backend  | http://localhost:8787 |

To run only one side:

```bash
bun run dev:web   # Vite frontend only
bun run dev:api   # Hono API + WS only
```

## Other commands

| Command                   | Description                 |
| ------------------------- | --------------------------- |
| `bun run build`           | Build frontend + type-check |
| `bun run lint`            | Run ESLint                  |
| `bun run prisma:generate` | Regenerate Prisma client    |
| `bun run prisma:push`     | Sync schema to database     |

## Debug monitor

The server has an optional in-memory debug monitor that tracks WebSocket session lifecycle, tool calls, Gemini events, and errors.

Enable it in `.env`:

```
DEBUG_MONITOR_ENABLED=true
DEBUG_MONITOR_MAX_EVENTS=2000
```

When enabled, the debug dashboard is available in the frontend.

## API reference

| Method | Path                             | Description             |
| ------ | -------------------------------- | ----------------------- |
| `GET`  | `/api/health`                    | Health check            |
| `GET`  | `/api/me`                        | Authenticated user info |
| `GET`  | `/api/projects`                  | List user's projects    |
| `POST` | `/api/projects`                  | Create a project        |
| `GET`  | `/api/projects/:id`              | Get project with nodes  |
| `POST` | `/api/projects/:id/story/import` | Import a story document |
| `WS`   | `/ws`                            | Gemini Live bridge      |

Auth endpoints are handled by Better Auth under `/api/auth/*` (sign-in, sign-out, session, OAuth callback).

- `GET /api/debug/monitor`
- `GET /api/debug/monitor/events?limit=100`
- `WS /ws`

## WebSocket Message Shapes (MVP)

Client -> Server:

- `{ type: "agent.context", payload: { projectId, activeSubAgents?, purpose? } }`
- `{ type: "gemini.clientContent", payload: { turns, turnComplete } }`
- `{ type: "gemini.realtimeInput", payload: { media: { mimeType, data } } }`

Server -> Client:

- `ws.ready`
- `gemini.server`
- `gemini.error`
- `gemini.closed`
- `agent.context.updated`
- `agent.session.rotated`

## Notes

- Story import enforces one story per project.
- Tool-call handlers are scaffolded and persist generated nodes.
- Mic UX currently toggles websocket-driven prompt mode; raw microphone streaming can be layered next with browser audio capture.
