# __PROJECT_NAME__

An agent server built with [loopengine](https://www.npmjs.com/package/loopengine).

## Setup

```bash
npm install
cp .env.example .env   # fill in ANTHROPIC_API_KEY
```

## Run

```bash
npm run dev             # HTTP server on :8787
```

```bash
curl -X POST localhost:8787/agents/example-agent/messages \
  -H 'content-type: application/json' \
  -d '{"message":"what is the weather in Boston?"}'
```

`sessionId` is optional — omit it for a fresh, one-off session (a
generated id, echoed back in the response as `sessionId` so you can pass
it in explicitly on a later request to continue that same conversation).

Or from the command line directly, no server needed:

```bash
npm run cli -- --agent example-agent "what is the weather in Boston?"
```

## Admin UI

`npm run dev`, then open:

- `http://localhost:8787/agents/config` — create agents, edit system
  prompts and models, connect Composio tool sources, and manage each
  agent's permission rules and skills, all from the browser. "Create new
  agent" writes a real folder under `agents/` and registers it live, no
  restart needed.
- `http://localhost:8787/playground` — send a real message to any agent
  and watch its tool calls and permission decisions happen live, approve
  or deny a gated call right there.

Both are wide open by default (local-only convenience) — set
`LOOPENGINE_ADMIN_AUTH="user:pass"` in `.env` before deploying anywhere
reachable by anyone but you (see `.env.example`).

## Add another agent

1. Copy `agents/example-agent/` to `agents/your-agent/` — `index.ts`
   (persona + which tools), `tools/` (one file per tool), `actauth.yml`
   (the permission story), and `skills/` if it needs any.
2. Edit `index.ts`'s `name` and `systemPrompt`, and `tools/index.ts`'s
   tool list. `rules`/`skillsDirs` don't need touching — they're left
   unset in `index.ts` on purpose, so they keep defaulting to
   `actauth.yml`/`skills/` next to it.
3. That's it — `agent-registry.ts` discovers it automatically by
   `AgentConfig.name`, no registration step. Nothing to edit, no import to
   add, no adapter change.
4. Call it at `/agents/your-agent/messages`.

`loopengine`'s own CLI scaffolds this same folder shape for you, if you'd
rather start empty than copy `example-agent/`:

```bash
npx loopengine add-agent your-agent
# -> Created agents/your-agent/index.ts
```

An agent can also be a single flat file — `agents/your-agent.ts` instead
of a folder — if it's simple enough not to need its own `tools/`,
`skills/`, or `actauth.yml`. It just can't have subagents (see below),
since there's no folder for `subagents/` to live under.

## Composing agents (subagents)

An agent's tools can be other agents. Drop a folder under
`agents/<name>/subagents/<child>/` and `child` becomes one of `name`'s
tools automatically — no import, no wiring. This requires `name` itself
to be in folder form (see above), since a flat file has no folder to nest
`subagents/` under:

```bash
npx loopengine add-agent support-orchestrator
npx loopengine add-subagent support-orchestrator billing-agent
```

`billing-agent` is then a normal `AgentConfig` (own tools, own
permission rules) plus one required field, `toolDescription` — the text
`support-orchestrator`'s model reads to decide when to delegate to it.
Calling that tool runs `billing-agent`'s whole loop to completion and
returns only its final answer; `support-orchestrator` never sees its
turns or tool calls. See
[loopengine's own README section on subagents](https://github.com/evanyan22/loopengine#4-subagents--an-agent-as-another-agents-tool)
for nesting, permission scoping, and the tradeoffs worth knowing before
reaching for this.

## Project layout

```
agent-registry.ts                Auto-discovers agents/* by AgentConfig.name — nothing to edit here
agents/example-agent/index.ts    Starter agent: persona, one tool
agents/example-agent/tools/      One tool (get_weather), aggregated in tools/index.ts
agents/example-agent/actauth.yml One permission rule (allow get_weather), default_decision: ask
agents/example-agent/skills/     One skill (convert-temperature) — instructions, not a tool call
adapters/http.ts                  HTTP API (streaming + non-streaming)
adapters/cli.ts                   Command-line adapter
```

## Adding external tools via Composio

Need an agent to call a real SaaS action (list GitHub repos, send a Slack
message) instead of a hand-written tool? Route it through
[Composio](https://composio.dev) via
[`mcpplug`](https://www.npmjs.com/package/mcpplug) rather than owning that
vendor's OAuth yourself — see loopengine's own
[README section on external tool gateways](https://github.com/evanyan22/loopengine#external-tool-gateways)
for the pattern, and `agents/file-agent.ts` in that repo for a complete,
working example. Not wired in here by default: it needs the `composio` CLI
installed and an authenticated account (`composio link <toolkit>`) first,
so it's a deliberate next step, not part of this starter agent.

See [loopengine's own README](https://github.com/evanyan22/loopengine) for
the full `AgentConfig` surface, permission rules, skills, and how to wire a
real model.
