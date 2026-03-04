# 2026-03-04 Voice Agent Scaffold Handoff

## Current Implementation Progress

### Completed foundation

- Frontend scaffold is in place with minimal React Flow canvas and mic indicator UI.
- Backend scaffold is running on Hono with HTTP API and WebSocket endpoints.
- Vite proxy is configured for `/api` and `/ws` to backend `localhost:8787`.
- Prisma is configured with MongoDB models for user/project/story/creative nodes.
- Better Auth + Google OAuth server wiring is implemented.
- Gemini Live server-side bridge is implemented, including tool-call routing.
- Environment contract is defined in `.env.example` and validated in `server/lib/env.ts`.
- Build currently passes (`bun run build`).

### Implemented domain constraints

- One user can have multiple projects.
- One project can only have one story (schema uniqueness + route-level guard).
- Story import from Google Docs URL to markdown is implemented as an API flow.

## Notes for Next Agent

- This is an MVP scaffold; most generation behaviors are placeholders and need product-grade implementations.
- `import_story_markdown` in tool handlers is currently a stub that points to REST import flow.
- WS input union is intentionally narrow (`gemini.clientContent`, `gemini.realtimeInput`, `agent.context`) and should stay consistent unless frontend and backend are updated together.
- Gemini API key is server-only by design; do not move Gemini SDK initialization to frontend.

## Next Steps (Priority Order)

1. **Real microphone streaming**
   - Add browser audio capture (PCM/compatible chunks) and send as `gemini.realtimeInput` through `src/lib/ws-client.ts`.
   - Add start/stop recording lifecycle and permission/error UX in `src/App.tsx`.

2. **Tool-call behavior completion**
   - Replace placeholder tool implementations in `server/services/tools.ts` with real orchestration:
     - character brief generation from story context
     - design inspiration generation
     - storyboard generation based on story + style
   - Ensure outputs persist to Prisma models and can be reflected as flow nodes.

3. **Flow sync from backend state**
   - Hydrate flow nodes from `/api/projects/:projectId`.
   - Map DB entities (`Story`, `CharacterNode`, `StyleNode`, `StoryboardNode`) to React Flow nodes/edges.
   - Add optimistic updates or websocket-driven updates for newly generated nodes.

4. **Auth UX completion**
   - Add explicit sign-in/sign-out controls in frontend using Better Auth client.
   - Handle unauthenticated state before opening websocket.
   - Improve `/api/me` bootstrap and session refresh behavior.

5. **Story import UX**
   - Add simple UI action to import Google Docs URL.
   - Surface one-story-only conflict (`409`) with clear user feedback.

6. **Stability and validation**
   - Add route-level payload validation for websocket messages beyond JSON parsing.
   - Add better error events for tool-call failures and propagate to UI.
   - Run `bun run lint` and resolve surfaced issues.

## Useful Commands

- Install: `bun install`
- Dev: `bun run dev`
- Build: `bun run build`
- Lint: `bun run lint`
- Prisma generate: `bun run prisma:generate`
- Prisma push: `bun run prisma:push`

## Key Reference Files

- Backend entry/app: `server/index.ts`, `server/app.ts`
- WS + Gemini bridge: `server/routes/ws.ts`, `server/lib/gemini.ts`
- Auth + env + db: `server/lib/auth.ts`, `server/lib/env.ts`, `server/lib/db.ts`
- Domain services: `server/services/project-service.ts`, `server/services/tools.ts`, `server/services/agent-router.ts`
- Story import: `server/routes/story.ts`, `server/services/story-import.ts`
- Frontend shell: `src/App.tsx`, `src/features/flow/nodes.ts`
- Frontend clients: `src/lib/ws-client.ts`, `src/lib/auth-client.ts`
- Data model: `prisma/schema.prisma`

## Suggested First Task for Next Agent

Implement end-to-end microphone capture and streaming first, then use generated events to validate the WS/Gemini loop before extending generation logic.
