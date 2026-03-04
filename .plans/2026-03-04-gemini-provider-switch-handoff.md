# 2026-03-04 Gemini Provider Switch Handoff

## Current Implementation Progress

- Added explicit provider selection with `GEMINI_PROVIDER` in env validation.
- Added provider-specific runtime validation:
  - `GEMINI_PROVIDER=ai_studio` requires `GEMINI_API_KEY`
  - `GEMINI_PROVIDER=vertex` requires `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_LOCATION`
- Refactored Gemini SDK initialization to support both providers in `server/lib/gemini.ts`:
  - AI Studio path uses API key.
  - Vertex path uses `vertexai: true` + project/location and Node ADC.
- Updated environment template and README with both configuration modes.

## Important Notes / Constraints

- Provider scope is global per server process (single env switch), not per user/project.
- `GEMINI_PROVIDER` is required and startup now fails fast if missing/invalid.
- `GEMINI_LIVE_MODEL` remains a single shared model env var across both providers.
- Vertex auth mode is ADC-based. Local/dev authentication can be done with:
  - `gcloud auth application-default login`, or
  - `GOOGLE_APPLICATION_CREDENTIALS` pointing to a service-account JSON file.
- Gemini credentials remain server-only; no frontend exposure was introduced.

## Prioritized Next Steps

1. Validate runtime behavior for both providers
   - AI Studio: set `GEMINI_PROVIDER=ai_studio` and `GEMINI_API_KEY`, then run websocket flow.
   - Vertex: set `GEMINI_PROVIDER=vertex`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION` with ADC configured.
2. Optionally add a startup log line indicating active provider/model for easier operations debugging.
3. If needed later, extend to provider-specific model env vars while preserving current fallback behavior.

## Files Changed

- `server/lib/env.ts`
- `server/lib/gemini.ts`
- `.env.example`
- `README.md`

## Useful Commands

- Lint: `bun run lint`
- API only: `bun run dev:api`
- Full app: `bun run dev`
