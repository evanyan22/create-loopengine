import type { ToolDefinition } from 'loopengine'

export const getWeather: ToolDefinition = {
  name: 'get_weather',
  description: 'Look up the weather for a city',
  input_schema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
  execute: async (input) => `Sunny in ${input.city}`,
}
