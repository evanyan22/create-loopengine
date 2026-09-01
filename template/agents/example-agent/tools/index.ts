// Aggregates this agent's tools — one file per tool, so adding another
// tool later means adding a file here and one line below, not touching
// index.ts. Mirrors loopengine's own agents/customer-service/tools/index.ts,
// except index.ts here imports this file explicitly (`tools,` in its
// AgentConfig) rather than omitting `tools` and relying on loopengine's
// own auto-import of this exact path: that default is resolved relative
// to loopengine's own installed location, so it only finds a tools/
// folder that lives inside loopengine's own repo, not your project's.
import type { ToolDefinition } from 'loopengine'
import { getWeather } from './get_weather.js'

export const tools: ToolDefinition[] = [getWeather]
