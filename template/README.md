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

## Add another agent

1. Copy `agents/example-agent.ts` to `agents/your-agent.ts` and edit its
   `name`, `systemPrompt`, `tools`, and `rules`.
2. That's it — `agent-registry.ts` discovers it automatically by
   `AgentConfig.name`, no registration step. Nothing to edit, no import to
   add, no adapter change.
3. Call it at `/agents/your-agent/messages`.

## Project layout

```
agent-registry.ts       Auto-discovers agents/*.ts by AgentConfig.name — nothing to edit here
agents/example-agent.ts Starter agent: persona, one tool, one permission rule
adapters/http.ts         HTTP API (streaming + non-streaming)
adapters/cli.ts          Command-line adapter
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
