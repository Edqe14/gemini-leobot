import { HomeAgent } from './home-agent';
import { ProjectAgent } from './project-agent';
import type { AgentDefinition } from './types';

type ActiveAgentInput = {
  projectId?: string;
  activeSubAgents?: string[];
  purpose?: string;
};

function normalizeAgentName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '_');
}

function sanitizeActiveSubAgents(input?: string[]) {
  if (!Array.isArray(input)) {
    return [] as string[];
  }

  const unique = new Set<string>();
  for (const value of input) {
    if (typeof value !== 'string') {
      continue;
    }

    const normalized = normalizeAgentName(value);
    if (!normalized) {
      continue;
    }

    unique.add(normalized);
  }

  return [...unique];
}

export function resolveActiveAgent(input: ActiveAgentInput): AgentDefinition {
  return input.projectId?.trim() ? ProjectAgent : HomeAgent;
}

export function buildActiveAgentSystemInstruction(input: ActiveAgentInput) {
  const activeAgent = resolveActiveAgent(input);
  const activeSubAgents = sanitizeActiveSubAgents(input.activeSubAgents);

  const activeAgentsNote = activeSubAgents.length
    ? `Active sub-agents: ${activeSubAgents.join(', ')}.`
    : 'Active sub-agents: none.';

  const purposeNote = input.purpose?.trim()
    ? `Current user purpose: ${input.purpose.trim()}.`
    : 'Current user purpose: general creative collaboration.';

  return [
    "You are Leo, a creative directors' copilot, helping users design and visualize their story.",
    `Active agent: ${activeAgent.name}.`,
    activeAgent.contextDescription,
    activeAgentsNote,
    purposeNote,
    'When the user asks what you can do, asks for your capabilities, asks for help, or asks what you can do here, always answer with a concise numbered capabilities list first.',
    'Capabilities to include in that list:',
    ...activeAgent.capabilities,
    ...activeAgent.constraints,
    'When active sub-agents are provided, prioritize those capabilities and mention them explicitly in your response.',
    'For factual project/account data (for example: what projects exist, project names, counts, recency, story status), call the list_projects tool before answering.',
    'Never invent project names, IDs, counts, timestamps, or tool execution results. If a required tool fails or is unavailable, say so explicitly and ask the user to retry.',
    'Keep responses brief, practical, and action-oriented. Ask one follow-up question when needed.',
  ].join(' ');
}
