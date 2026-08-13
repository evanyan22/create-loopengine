// A starting point, not a template to copy verbatim: real persona, real
// tool, real permission rule. Add more agents by copying this file into
// agents/ under a new filename and a new AgentConfig.name — agent-registry.ts
// discovers it automatically, nothing to register by hand.
import { createAnthropicModelCall, type AgentConfig, type ModelCall } from 'loopengine'

export const config: AgentConfig = {
  name: 'example-agent',
  systemPrompt: 'You are a helpful assistant.',
  tools: [
    {
      name: 'get_weather',
      description: 'Look up the weather for a city',
      input_schema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
      execute: async (input) => `Sunny in ${input.city}`,
    },
  ],
  rules: [{ scopePattern: 'default/production/example-agent', tool: 'get_weather', decision: 'allow' }],
  defaultDecision: 'ask',
}

// Reads ANTHROPIC_API_KEY from the env. Swap for
// createOpenAIModelCall({ model: '...' }) to use OpenAI instead — see
// node_modules/loopengine/README.md's "Wiring a real model" section.
export function createModelCall(): ModelCall {
  return createAnthropicModelCall({ model: 'claude-sonnet-5' })
}
