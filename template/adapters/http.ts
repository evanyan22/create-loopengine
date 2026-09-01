// Channel adapter #2: HTTP API.
//
//   npm run dev
//
//   curl -X POST localhost:8787/agents/example-agent/messages \
//     -H 'content-type: application/json' \
//     -d '{"message":"what is the weather in Boston?"}'
//
//   # same request, but as it happens: one SSE event per loop step
//   curl -N -X POST localhost:8787/agents/example-agent/messages/stream \
//     -H 'content-type: application/json' \
//     -d '{"message":"what is the weather in Boston?"}'
//
// sessionId is optional — omit it for a fresh, one-off session (a
// generated id, echoed back in the response as sessionId so you can pass
// it in explicitly on a later request to continue that same conversation).
//
// Owns: routing by agent name, request/response shape, and (via
// SessionStore.withSession) making sure two concurrent requests for the
// same session don't race on read-modify-write of that session's history.
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createSessionStore, runAgent, type AgentConfig } from 'loopengine'
import { getEntry, type RegistryEntry } from '../agent-registry.js'

const sessions = createSessionStore()

// Off entirely (every route open, no setup needed) when LOOPENGINE_ADMIN_AUTH
// isn't set — meant to run locally with zero config by default. Set it
// ("user:pass") before deploying anywhere reachable by anyone but you.
const adminAuth = process.env.LOOPENGINE_ADMIN_AUTH
if (!adminAuth) {
  console.warn(
    '[my-agents] LOOPENGINE_ADMIN_AUTH is not set — every route on this server (including conversation history) is open to anyone who can reach it. Set LOOPENGINE_ADMIN_AUTH="user:pass" to require HTTP Basic Auth.',
  )
}

// Compares the whole "user:pass" string as one shared secret, not username
// and password separately. timingSafeEqual requires equal-length buffers,
// so length is checked first — a length mismatch isn't sensitive
// information worth spending a constant-time comparison to protect.
function isAuthorized(req: IncomingMessage): boolean {
  if (!adminAuth) return true
  const header = req.headers.authorization
  if (!header || !header.startsWith('Basic ')) return false
  const provided = Buffer.from(header.slice('Basic '.length), 'base64')
  const expected = Buffer.from(adminAuth)
  return provided.length === expected.length && timingSafeEqual(provided, expected)
}

// Deriving a session key from something richer than a plain client-supplied
// id (a customer's email, a Slack channel, ...) is business logic specific
// to what an agent is for — see AgentConfig.sessionIdFor. This is only the
// agent-agnostic fallback: a missing sessionId just means "no ongoing
// conversation to resume," so one is generated rather than treated as an error.
function defaultSessionIdFor(body: Record<string, unknown>): string | undefined {
  const sessionId = body.sessionId
  return typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : undefined
}

function sessionIdFor(config: AgentConfig, body: Record<string, unknown>): string | undefined {
  if (config.sessionIdFor) return config.sessionIdFor(body)
  return defaultSessionIdFor(body) ?? randomUUID()
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => (data += chunk))
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

interface ParsedRequest {
  entry: RegistryEntry
  message: string
  rawSessionId: string
  storageSessionId: string
}

type ParseResult = { ok: true; value: ParsedRequest } | { ok: false; status: number; error: string }

async function parseRequest(req: IncomingMessage, agentName: string): Promise<ParseResult> {
  const entry = getEntry(agentName)
  if (!entry) return { ok: false, status: 404, error: `unknown agent '${agentName}'` }

  const body = await readJsonBody(req)
  const message = String(body.message ?? '')
  const rawSessionId = sessionIdFor(entry.config, body)
  if (!message) return { ok: false, status: 400, error: 'message is required' }
  if (!rawSessionId) return { ok: false, status: 400, error: 'could not derive a session id from the request body' }

  // Namespaced by agent name so two agents given the same sessionId don't
  // read/write the same underlying log.
  return { ok: true, value: { entry, message, rawSessionId, storageSessionId: `${agentName}:${rawSessionId}` } }
}

function writeSseEvent(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

async function handleMessages(req: IncomingMessage, res: ServerResponse, agentName: string): Promise<void> {
  const parsed = await parseRequest(req, agentName)
  if (!parsed.ok) {
    res.writeHead(parsed.status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: parsed.error }))
    return
  }
  const { entry, message, rawSessionId, storageSessionId } = parsed.value

  const text = await sessions.withSession(storageSessionId, async (history) => {
    const result = await runAgent(entry.config, entry.createModelCall(), message, history)
    return { newMessages: result.newMessages, result: result.text }
  })

  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ text, sessionId: rawSessionId }))
}

async function handleMessagesStream(req: IncomingMessage, res: ServerResponse, agentName: string): Promise<void> {
  const parsed = await parseRequest(req, agentName)
  if (!parsed.ok) {
    res.writeHead(parsed.status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: parsed.error }))
    return
  }
  const { entry, message, rawSessionId, storageSessionId } = parsed.value

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
  writeSseEvent(res, 'session', { sessionId: rawSessionId })

  try {
    await sessions.withSession(storageSessionId, async (history) => {
      const result = await runAgent(entry.config, entry.createModelCall(), message, history, {
        onEvent: (event, detail) => writeSseEvent(res, event, detail),
      })
      writeSseEvent(res, 'done', { text: result.text })
      return { newMessages: result.newMessages, result: result.text }
    })
  } catch (err) {
    writeSseEvent(res, 'error', { error: String(err) })
  } finally {
    res.end()
  }
}

const server = createServer(async (req, res) => {
  if (!isAuthorized(req)) {
    res
      .writeHead(401, { 'content-type': 'application/json', 'www-authenticate': 'Basic realm="my-agents"' })
      .end(JSON.stringify({ error: 'authorization required' }))
    return
  }

  try {
    const streamMatch = req.method === 'POST' && req.url?.match(/^\/agents\/([^/]+)\/messages\/stream$/)
    if (streamMatch) {
      await handleMessagesStream(req, res, decodeURIComponent(streamMatch[1]))
      return
    }

    const match = req.method === 'POST' && req.url?.match(/^\/agents\/([^/]+)\/messages$/)
    if (!match) {
      res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'not found' }))
      return
    }

    await handleMessages(req, res, decodeURIComponent(match[1]))
  } catch (err) {
    if (res.headersSent) {
      res.end()
    } else {
      res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: String(err) }))
    }
  }
})

const port = Number(process.env.PORT ?? 8787)
server.listen(port, () => console.log(`agent API listening on :${port}`))

async function shutdown() {
  server.close()
  await sessions.close()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
