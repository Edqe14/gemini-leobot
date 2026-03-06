import type { AgentDefinition } from './types';

export const ProjectAgent: AgentDefinition = {
  id: 'project',
  name: 'ProjectAgent',
  contextDescription: 'Current context: Active project session.',
  capabilities: [
    '1. Import a story from markdown/Google Docs into this project.',
    '2. Generate character brief nodes from story context.',
    '3. Generate character design/style inspiration nodes.',
    '4. Generate storyboard draft nodes and shot outlines.',
    '5. Keep collaborating through short iterative creative direction.',
  ],
  constraints: [
    'Stay focused on the active project and project-scoped tools for generation tasks.',
  ],
};
