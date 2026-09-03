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
npx create-loopengine@latest my-agents
cd my-agents
npm install
cp .env.example .env   # fill in ANTHROPIC_API_KEY
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

No name given? `npx create-loopengine@latest` on its own scaffolds into
`./my-agents`.

## What you get

A real, standalone project — its own `package.json` depending on
`loopengine`, not a copy of loopengine's own repo:

```
package.json             Depends on loopengine — your project, not a fork
agent-registry.ts         Auto-discovers agents/*.ts by AgentConfig.name — nothing to edit here
agents/example-agent.ts   Starter agent: persona, one tool, one permission rule
adapters/http.ts          HTTP API (streaming + non-streaming), routes by agent name
adapters/cli.ts           Command-line adapter
.env.example              ANTHROPIC_API_KEY / OPENAI_API_KEY / REDIS_URL
.create-loopengine.json   Which version this project was scaffolded from — see "Upgrading" below
```

The registry is multi-agent-capable from the start — seeded with one
example agent, not architecturally limited to one — built on loopengine's
own `discoverAgents`: it scans `agents/` and keys each entry by
`AgentConfig.name`, not the filename, so adding a second agent later is
one new file, not a rewrite and not a registry edit either. See
[loopengine's own README](https://github.com/evanyan22/loopengine) for the
full `AgentConfig` surface: permission rules, skills, context-budget
recovery, and how to wire a real model (Anthropic, OpenAI, or DeepSeek —
all three included).

## Add another agent

1. Copy `agents/example-agent.ts` to `agents/your-agent.ts` and edit its
   `name`, `systemPrompt`, `tools`, and `rules`.
2. That's it — `agent-registry.ts` discovers it automatically, no
   registration step.
3. Call it at `/agents/your-agent/messages`.

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

## Upgrading

`npm install loopengine@latest` alone only picks up library-side changes
— `adapters/http.ts`, `adapters/cli.ts`, and `agent-registry.ts` are
copied into your project once at scaffold time and never touched by npm
again, so template improvements (new routes, bug fixes) don't reach an
existing project on their own. `upgrade` closes that gap with a real
three-way merge — the same technique `git merge` uses — so your own
edits to those files survive:

```bash
npx create-loopengine@latest upgrade
```

Run from inside your project. It merges the current template against
whichever `create-loopengine` version your project was originally
scaffolded from (recorded in `.create-loopengine.json`, written
automatically at scaffold time — pass `--from <version>` if that file is
missing, e.g. for a project scaffolded before this command existed).
Each of the five template-owned files gets one of:

- **unchanged** — the template never touched this file between your
  version and the latest; nothing to merge, nothing overwritten.
- **updated** — merged cleanly; your own edits and the template's own
  changes didn't overlap.
- **conflict** — you edited the same lines the template changed. The
  file is written with real `<<<<<<<`/`=======`/`>>>>>>>` markers, same
  as any git merge conflict — resolve them by hand, then `npx tsc
  --noEmit` to confirm it builds.

`upgrade` never touches `agents/`, `README.md`, `.env.example`, or
`package.json`'s own dependency versions — run `npm install
loopengine@latest` (and `actauth`/`skillgarden` if you use them directly)
separately to pick those up.

## Running in production

`npm run dev` (`tsx watch`) restarts on every file change — fine for
local iteration, wrong for a real server, since a restart drops every
in-flight request and any pending live approval/question (see
loopengine's own README on durable vs. live approvers if that matters to
you). Use [pm2](https://pm2.keymetrics.io/) to run the plain, non-watch
server instead, with restart-on-crash:

```bash
pm2 start npx --name my-agents --interpreter none -- loopengine serve
pm2 save                # persist across reboots
pm2 startup              # (one-time) launch pm2 itself on boot
```

`--interpreter none` matters — without it pm2 may try to run `npx`
through `node` directly, which fails since it's a shell-invokable binary,
not a bare `.js` file. `--` separates pm2's own flags from the command's
own args (`loopengine serve`).

Two gotchas worth knowing before they cost you a debugging session:

- **`npm` is not `npx`.** `pm2 start npm --name my-agents -- loopengine
  serve` does *not* work — `npm <args>` treats its args as npm's own
  subcommands, not a binary to run, so it fails with `Unknown command:
  "loopengine"`. If you'd rather invoke via `npm`, add a `"start":
  "loopengine serve"` script to `package.json` first, then `pm2 start npm
  --name my-agents -- start` (npm special-cases `start` as a shorthand
  for running that script, unlike arbitrary script names).
- **pm2 remembers a name's original `cwd`/script, not whatever you pass
  next time.** Running `pm2 start ... --name my-agents` again after
  moving/recreating the project directory just restarts the *already-
  registered* process with its *original* path — your new files are
  never even read. Run `pm2 delete my-agents` first if the project's
  location changed, then start fresh.

`pm2 logs my-agents` tails output; `pm2 restart my-agents` after any
manual edit to `adapters/http.ts`/`adapters/cli.ts`/`agent-registry.ts`
(see "Upgrading" above) or an env var change — those don't take effect
until the process restarts. Adding a skill or tool through the Admin UI
does *not* need a restart — that's applied to the already-running process
directly.

## Status

Verified end to end against the real published packages: `npm create
loopengine@latest` resolves and scaffolds, `npm install` resolves
`loopengine` from the registry, the generated project typechecks clean,
and the real HTTP server starts and correctly routes a request through
session storage, permission gating, and tool scheduling up to the model
call itself.

MIT licensed.
