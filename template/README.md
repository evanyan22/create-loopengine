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
  -d '{"sessionId":"s1","message":"what is the weather in Boston?"}'
```

Or from the command line directly, no server needed:

```bash
npm run cli -- --agent example-agent "what is the weather in Boston?"
```

## Add another agent

1. Copy `agents/example-agent.ts` to `agents/your-agent.ts` and edit its
   `systemPrompt`, `tools`, and `rules`.
2. Register it in `agent-registry.ts` — one line, same shape as
   `example-agent`.
3. Call it at `/agents/your-agent/messages`.

## Project layout

```
agent-registry.ts       Maps agent name -> {config, createModelCall}
agents/example-agent.ts Starter agent: persona, one tool, one permission rule
adapters/http.ts         HTTP API (streaming + non-streaming)
adapters/cli.ts          Command-line adapter
```

See [loopengine's own README](https://github.com/evanyan22/loopengine) for
the full `AgentConfig` surface, permission rules, skills, and how to wire a
real model.
