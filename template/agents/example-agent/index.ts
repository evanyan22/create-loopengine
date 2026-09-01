// A starting point, not a template to copy verbatim: real persona, real
// tool, real permission rule — one folder per agent, the same convention
// agents/customer-service/ uses in loopengine's own repo. Add more agents
// by copying this whole folder under a new name and a new AgentConfig.name
// — agent-registry.ts discovers it automatically, nothing to register by
// hand.
//
// `rules` and `skillsDirs` are both left unset here on purpose — omitting
// them defaults to actauth.yml and skills/ alongside this file (loopengine
// resolves both relative to wherever you run the process). `tools` is set
// explicitly instead of relying on the equivalent tools/ default: that one
// resolves relative to loopengine's own installed location, not your
// project, so it only works inside loopengine's own repo — see
// tools/index.ts's own comment.
import { createAnthropicModelCall, type AgentConfig, type ModelCall } from 'loopengine'
import { tools } from './tools/index.js'

export const config: AgentConfig = {
  name: 'example-agent',
  systemPrompt: 'You are a helpful assistant.',
  tools,
}

// Reads ANTHROPIC_API_KEY from the env. Swap for
// createOpenAIModelCall({ model: '...' }) to use OpenAI instead — see
// node_modules/loopengine/README.md's "Wiring a real model" section.
export function createModelCall(): ModelCall {
  return createAnthropicModelCall({ model: 'claude-sonnet-5' })
}
