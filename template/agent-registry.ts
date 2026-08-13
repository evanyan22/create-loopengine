// Every adapter resolves "which agent" through this — the thing that
// makes agents pluggable. Defining a new agent means adding one line here;
// no adapter changes needed.
import type { AgentConfig, ModelCall } from 'loopengine'
import { config as exampleAgentConfig, createModelCall as createExampleAgentModelCall } from './agents/example-agent.js'

export interface RegistryEntry {
  config: AgentConfig
  /** Factory, not a shared instance — a fresh ModelCall per request/session. */
  createModelCall: () => ModelCall
}

const entries: Record<string, RegistryEntry> = {
  'example-agent': { config: exampleAgentConfig, createModelCall: createExampleAgentModelCall },
}

export function listAgents(): string[] {
  return Object.keys(entries)
}

/** undefined for an unknown agent name. */
export function getEntry(name: string): RegistryEntry | undefined {
  return entries[name]
}
