# create-loopengine

**Scaffold a new [loopengine](https://www.npmjs.com/package/loopengine)
agent project — a runnable HTTP server, in your own repo, in one command.**

`npm install loopengine` alone only gets you the library (`runAgent`,
`AgentConfig`, session stores) — the HTTP server, the agent registry, and a
runnable example are deliberately not part of that package. `create-loopengine`
is the other half: a Rails/Laravel-style generator that gives you a
complete, working project to build on, instead of a library import or a
clone of loopengine's own source repo.

## Usage

```bash
npm create loopengine@latest my-agents
cd my-agents
npm install
cp .env.example .env   # fill in ANTHROPIC_API_KEY
npm run dev             # HTTP server on :8787
```

```bash
curl -X POST localhost:8787/agents/example-agent/messages \
  -H 'content-type: application/json' \
  -d '{"sessionId":"s1","message":"what is the weather in Boston?"}'
```

No name given? `npm create loopengine@latest` on its own scaffolds into
`./my-agents`.

## What you get

A real, standalone project — its own `package.json` depending on
`loopengine`, not a copy of loopengine's own repo:

```
package.json             Depends on loopengine — your project, not a fork
agent-registry.ts         Maps agent name -> {config, createModelCall}, one line per agent
agents/example-agent.ts   Starter agent: persona, one tool, one permission rule
adapters/http.ts          HTTP API (streaming + non-streaming), routes by agent name
adapters/cli.ts           Command-line adapter
.env.example              ANTHROPIC_API_KEY / OPENAI_API_KEY / REDIS_URL
```

The registry is multi-agent-capable from the start — seeded with one
example agent, not architecturally limited to one — so adding a second
agent later is one file plus one line in `agent-registry.ts`, not a
rewrite. See the generated `README.md` for how to add one, and
[loopengine's own README](https://github.com/evanyan22/loopengine) for the
full `AgentConfig` surface: permission rules, skills, context-budget
recovery, and how to wire a real model (Anthropic or OpenAI, both included).

## Status

Verified end to end against the real published packages: `npm create
loopengine@latest` resolves and scaffolds, `npm install` resolves
`loopengine` from the registry, the generated project typechecks clean,
and the real HTTP server starts and correctly routes a request through
session storage, permission gating, and tool scheduling up to the model
call itself.

MIT licensed.
