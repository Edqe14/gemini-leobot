# Project Guidelines

## Tech Stack

- Runtime & package manager: Bun scripts, Node runtime for API server.
- Frontend: React 19 + Vite 7 + TypeScript + React Flow.
- UI & styling: Tailwind CSS v4, shadcn-style UI primitives, Lucide icons.
- Backend: Hono HTTP API + Hono WebSocket (`@hono/node-server`, `@hono/node-ws`).
- AI integration: Gemini Live API via `@google/genai` (server-side bridge).
- Auth: Better Auth with Google OAuth + Prisma adapter.
- Database/ORM: MongoDB + Prisma (v6 client/CLI).
- Validation/config: Zod + dotenv.

## Code Style

- Use TypeScript with strict settings; follow existing compiler constraints in `tsconfig.app.json` and `tsconfig.server.json`.
- Prefer `@` imports for frontend code (`src/*`), matching `vite.config.ts` + `tsconfig.app.json` alias config.
- Reuse UI primitives in `src/components/ui/*` and utility `cn()` in `src/lib/utils.ts`.
- Keep styling token-based via `src/index.css` (Tailwind v4 + CSS vars); avoid ad-hoc color systems.
- Match existing formatting style in touched files (repo currently uses semicolons in many server files).

## Architecture

- Frontend: Vite React app with minimal canvas shell in `src/App.tsx` and graph definitions in `src/features/flow/nodes.ts`.
- Backend: Hono app created in `server/app.ts`, served from `server/index.ts`.
- API routes are HTTP under `/api/*`; realtime is WebSocket on `/ws` (`server/routes/ws.ts`).
- Gemini Live bridge lives in `server/lib/gemini.ts` and routes tool calls through `server/services/agent-router.ts`.
- Data model is Prisma + MongoDB in `prisma/schema.prisma`.

## Build and Test

- Install: `bun install`
- Run web + api: `bun run dev`
- Run web only: `bun run dev:web`
- Run api only: `bun run dev:api`
- Build: `bun run build`
- Lint: `bun run lint`
- Prisma client: `bun run prisma:generate`
- Push schema: `bun run prisma:push`
- No test suite is configured yet; do not invent test commands.

## Planning Handoffs

- Use `.plans/` for implementation handoff docs between agents.
- Create one markdown file per handoff named `YYYY-MM-DD-short-summary.md`.
- Each handoff file must include: current implementation progress, important notes/constraints, and prioritized next steps for the next agent.
- Include concrete file references and runnable commands when relevant.
- Keep handoff docs concise and append a new file for each meaningful milestone instead of overwriting older plans.

## Project Conventions

- Keep frontend network calls relative (`/api`, `/ws`) to preserve Vite proxy behavior in `vite.config.ts`.
- Enforce auth on protected routes using `getSessionFromHeaders()` from `server/lib/auth.ts`.
- One project can have only one story: preserve both DB uniqueness and route-level guard (`prisma/schema.prisma`, `server/routes/story.ts`).
- Project reads typically include story + node aggregates (`server/services/project-service.ts`).
- WS client messages should stay within current union (`gemini.clientContent`, `gemini.realtimeInput`, `agent.context`) in `server/routes/ws.ts`.

## Integration Points

- Better Auth + Google OAuth are configured in `server/lib/auth.ts` with base path `/api/auth`.
- Prisma adapter uses Mongo provider and singleton client in `server/lib/db.ts`.
- Gemini Live SDK integration is server-side only; browser communicates via backend WS bridge.
- Frontend auth client is in `src/lib/auth-client.ts`; WS client is in `src/lib/ws-client.ts`.

## Security

- Never commit secrets; use `.env` based on `.env.example`.
- Validate and read env from `server/lib/env.ts`; add new vars there with zod validation.
- Keep `trustedOrigins` and CORS aligned with `APP_BASE_URL`/`API_BASE_URL` (`server/lib/auth.ts`, `server/app.ts`).
- Do not expose `GEMINI_API_KEY` to the browser; all Gemini calls must remain backend-mediated.
- Preserve unauthorized WS close behavior (code `1008`) in `server/routes/ws.ts`.
