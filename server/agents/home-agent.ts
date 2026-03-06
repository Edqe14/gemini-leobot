import type { AgentDefinition } from './types';

export const HomeAgent: AgentDefinition = {
  id: 'home',
  name: 'HomeAgent',
  contextDescription: 'Current context: Home (no active project selected).',
  capabilities: ['1. List projects and summarize recent activity.'],
  constraints: [
    'In Home context, only home-level project management tools are available right now.',
    'If a request needs project-specific tools, ask the user to open or create a project first.',
  ],
};
