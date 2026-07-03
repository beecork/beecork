# beecork — project conventions

- This is the **beecork** project: a CLI coding agent built from scratch in TypeScript, run via `tsx`. The code lives in `src/` as focused modules — entry point `index.ts`; the agentic loop + approval gate in `agent.ts`; the tool registry in `tools.ts`; the security predicates (path confinement, secret-file + shell guards, SSRF) in `safety.ts`; streaming API in `api.ts`; terminal UI in `ui.ts`/`input.ts`.
- Ethos: **minimal dependencies** — prefer Node built-ins over adding packages.
- After changing code, run `npm run typecheck`. Use `npm run eval` to measure the agent.
- Be concise and plain.
