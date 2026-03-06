import { Type } from '@google/genai';
import type { AgentDefinition } from './types';
import {
  createProjectTool,
  listProjectsTool,
  setActiveProjectTool,
} from '../services/tools';

export const HomeAgent: AgentDefinition = {
  id: 'home',
  name: 'HomeAgent',
  contextDescription: 'Current context: Home (no active project selected).',
  toolDeclarations: [
    {
      name: 'list_projects',
      description:
        'List all projects for the authenticated user, including recency and node/story summary metadata.',
      handler: listProjectsTool,
    },
    {
      name: 'create_project',
      description:
        'Create a new project for the authenticated user in home context.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          name: {
            type: Type.STRING,
            description: 'Project name (1-120 characters).',
          },
        },
        required: ['name'],
      },
      handler: createProjectTool,
    },
    {
      name: 'set_active_project',
      description:
        'Set the active project for this session. Always call list_projects first and pass a verified projectId from that result.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          projectId: {
            type: Type.STRING,
            description: 'Project ID to activate.',
          },
          name: {
            type: Type.STRING,
            description: 'Project name to activate when ID is not provided.',
          },
        },
      },
      handler: setActiveProjectTool,
    },
  ],
  toolInstructions: [
    'For factual project/account data (for example: what projects exist, project names, counts, recency, story status), call the list_projects tool before answering.',
    'When the user asks to set or switch the active project, always call list_projects first, choose the project from that returned list, then call set_active_project with the verified projectId.',
    'If the requested project is not present in the list_projects results, do not call set_active_project blindly; instead explain it was not found and ask whether to create_project.',
    'After set_active_project succeeds, explicitly confirm to the user that the project is now active and include the active project name in that confirmation.',
  ],
  capabilities: [
    '1. List projects and summarize recent activity.',
    '2. Create a new project from Home context.',
    '3. Set an active project for project-scoped collaboration.',
  ],
  constraints: [
    'In Home context, only home-level project management tools are available right now.',
    'If a request needs project-specific tools, ask the user to open or create a project first.',
  ],
};
