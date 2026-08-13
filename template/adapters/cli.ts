#!/usr/bin/env node
// Channel adapter #1: command line.
//
//   npm run cli -- --agent example-agent "what's the weather in Boston?"
//
// Omit --session for a one-off ask — each call gets its own fresh,
// isolated session (a random id, printed to stderr so it can be reused
// with --session <id> later to continue that conversation).
import { randomUUID } from 'node:crypto'
import { createSessionStore, runAgent } from 'loopengine'
import { getEntry, listAgents } from '../agent-registry.js'

function parseArgs(argv: string[]) {
  let agent = ''
  let session: string | undefined
  const rest: string[] = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--agent') agent = argv[++i]
    else if (argv[i] === '--session') session = argv[++i]
    else rest.push(argv[i])
  }
  return { agent, session, message: rest.join(' ') }
}

async function main() {
  const { agent, session, message } = parseArgs(process.argv.slice(2))
  const entry = getEntry(agent)
  if (!entry) {
    console.error(`unknown agent '${agent}'. available: ${listAgents().join(', ')}`)
    process.exit(1)
  }
  if (!message) {
    console.error('usage: cli.ts --agent <name> [--session <id>] "<message>"')
    process.exit(1)
  }

  const sessionId = session ?? randomUUID()
  if (!session) console.error(`[session] ${sessionId} (pass --session ${sessionId} to continue this conversation)`)

  const sessions = createSessionStore()
  try {
    // Namespaced by agent name so the same --session id reused across two
    // different agents doesn't read/write the same underlying log.
    const text = await sessions.withSession(`${agent}:${sessionId}`, async (history) => {
      const result = await runAgent(entry.config, entry.createModelCall(), message, history, {
        onEvent: (event, detail) => console.error(`[${event}]`, detail),
      })
      return { newMessages: result.newMessages, result: result.text }
    })
    console.log(text)
  } finally {
    await sessions.close()
  }
}

main()
