# AgentPlane

A multi-tenant platform for running Claude Code agents in isolated Vercel Sandboxes, exposed via a REST API.

## Architecture

**Stack:** Next.js 16 (App Router) · TypeScript · Neon Postgres · Vercel Sandbox · Vercel Blob · Tailwind CSS v4

**Core concepts:**
- **Tenant** — isolated workspace with its own API keys, agents, and budget
- **Agent** — configuration (model, tools, permissions, git repo) that runs Claude Code
- **Run** — a single agent execution triggered by a prompt; streams SSE events

**Execution flow:**
1. Client POSTs to `/api/agents/:id/runs` with a prompt
2. A Vercel Sandbox is created, Claude Code runs inside it
3. Events stream back over SSE (`run_started`, `assistant`, `tool_use`, `tool_result`, `result`)
4. Transcript stored in Vercel Blob; token usage + cost recorded in DB

## Key Commands

```bash
npm run dev          # start dev server
npm run build        # type-check + build (Next.js)
npm run test         # vitest run
npm run migrate      # run DB migrations (requires DATABASE_URL)
npm run create-tenant # create a tenant + API key
```

## Project Structure

```
src/
  app/
    api/            # REST API routes
      agents/       # CRUD + run creation
      runs/         # run status, cancel, transcript
      admin/        # admin-only endpoints
      cron/         # scheduled jobs (budget reset, cleanup)
      health/       # health check
      keys/         # API key management
      tenants/      # tenant management
    admin/          # Admin UI (Next.js pages)
  db/
    index.ts        # DB client (Pool, query helpers, transactions)
    migrate.ts      # migration runner
    migrations/     # sequential SQL migration files
  lib/
    types.ts        # branded types, domain interfaces, StreamEvent union
    env.ts          # Zod-validated env (getEnv())
    auth.ts         # API key authentication
    admin-auth.ts   # admin API key auth
    sandbox.ts      # Vercel Sandbox creation + Claude Code runner
    composio.ts     # Composio MCP integration
    mcp.ts          # MCP server utilities
    runs.ts         # run lifecycle helpers
    streaming.ts    # SSE streaming utilities
    transcripts.ts  # Vercel Blob transcript storage
    api.ts          # withErrorHandler, jsonResponse helpers
    validation.ts   # Zod request/response schemas
    crypto.ts       # ID generation, key hashing (ENCRYPTION_KEY)
    rate-limit.ts   # Vercel KV-based rate limiting
    errors.ts       # typed error classes
    logger.ts       # structured logger
    utils.ts        # misc helpers
  components/       # React UI components
    ui/             # shared UI primitives
  middleware.ts     # auth middleware
scripts/
  create-tenant.ts  # CLI to provision tenant + API key
tests/              # Vitest tests
```

## Database

Neon Postgres with Row-Level Security (RLS). Tables: `tenants`, `api_keys`, `agents`, `runs`.

- Agent names are unique per tenant
- RLS enforced via `app.current_tenant_id` session config
- Tenant-scoped transactions via `withTenantTransaction()`
- Migrations: numbered SQL files in `src/db/migrations/`, run via `npm run migrate`

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Neon connection string (pooled) |
| `DATABASE_URL_DIRECT` | No | Direct connection (migrations) |
| `ADMIN_API_KEY` | Yes | Admin API authentication |
| `AI_GATEWAY_API_KEY` | Yes | Vercel AI Gateway key |
| `ENCRYPTION_KEY` | No | 64 hex chars (32 bytes) for key encryption |
| `BLOB_READ_WRITE_TOKEN` | No | Vercel Blob (transcript storage) |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | No | Vercel KV (rate limiting) |
| `CRON_SECRET` | No | Vercel Cron authentication |
| `COMPOSIO_API_KEY` | No | Composio MCP tool integration |

## API Authentication

All routes (except `/api/health`) require `Authorization: Bearer <api_key>`. Admin routes use `ADMIN_API_KEY`. API keys are hashed with SHA-256; optionally encrypted at rest with `ENCRYPTION_KEY`.

## Deployment

- **Hosting:** Vercel (catalystiq team)
- **Production:** `agentplane.vercel.app`
- Push to `main` triggers automatic production deploy
- Run `npm run migrate` separately when migrations are added (requires `DATABASE_URL_DIRECT`)

## Patterns & Conventions

- Branded types (`TenantId`, `AgentId`, `RunId`) prevent parameter swaps at compile time
- All DB queries go through typed helpers in `src/db/index.ts` with Zod validation
- Use `withErrorHandler()` wrapper on every API route handler
- Composio MCP server URL + API key are cached per agent in the `agents` table
- Agent skills are injected as files into the sandbox before Claude runs
