import { Type } from '@google/genai';
import type { AgentDefinition } from './types';
import {
  createStoryNodeTool,
  generateCharacterBriefTool,
  generateCharacterInspirationTool,
  generateStoryboardTool,
  listProjectsTool,
  syncStoryNodeTool,
} from '../services/tools';

export const ProjectAgent: AgentDefinition = {
  id: 'project',
  name: 'ProjectAgent',
  contextDescription: 'Current context: Active project session.',
  toolDeclarations: [
    {
      name: 'list_projects',
      description:
        'List all projects for the authenticated user, including recency and node/story summary metadata.',
      handler: listProjectsTool,
    },
    {
      name: 'create_story_node',
      description:
        'Create (or ensure) a story node in the active project so the user can paste markdown or use Google Docs import from the UI.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          defaultTabType: {
            type: Type.STRING,
            description:
              'Optional preferred tab for UI input. Use "markdown" for paste flow or "google_docs" for link flow.',
          },
          title: {
            type: Type.STRING,
            description: 'Optional initial story title when creating the node.',
          },
          storyNodeId: {
            type: Type.STRING,
            description:
              'Optional existing story node ID to verify before updating.',
          },
        },
      },
      handler: createStoryNodeTool,
    },
    {
      name: 'sync_story_node',
      description:
        'Resolve related project nodes, verify if a requested story node ID exists, and then create or update the active story using a concrete resolved node ID.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          storyNodeId: {
            type: Type.STRING,
            description:
              'Optional story node ID to verify. If missing/deleted, the tool returns the resolved active story node ID.',
          },
          defaultTabType: {
            type: Type.STRING,
            description:
              'Optional preferred tab for UI input. Use "markdown" or "google_docs".',
          },
          title: {
            type: Type.STRING,
            description:
              'Optional story title to apply when syncing the story node.',
          },
        },
      },
      handler: syncStoryNodeTool,
    },
    {
      name: 'generate_character_brief',
      description:
        'Create a character node in the active project using provided name and brief text.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          name: {
            type: Type.STRING,
            description: 'Character name to use for the generated node.',
          },
          brief: {
            type: Type.STRING,
            description: 'Character brief markdown content.',
          },
        },
      },
      handler: generateCharacterBriefTool,
    },
    {
      name: 'generate_character_inspiration',
      description:
        'Create a style/inspiration node for the active project based on provided style direction.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          styleName: {
            type: Type.STRING,
            description: 'Short style label for the inspiration node.',
          },
          description: {
            type: Type.STRING,
            description: 'Visual style description and direction.',
          },
        },
      },
      handler: generateCharacterInspirationTool,
    },
    {
      name: 'generate_storyboard',
      description:
        'Create a storyboard node for the active project with title and optional shot array.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          title: {
            type: Type.STRING,
            description: 'Storyboard title.',
          },
          shots: {
            type: Type.ARRAY,
            description:
              'Optional shot list to store in the storyboard node. Each item should be a JSON object.',
            items: {
              type: Type.OBJECT,
            },
          },
        },
      },
      handler: generateStoryboardTool,
    },
  ],
  toolInstructions: [
    'For factual project/account data (for example: what projects exist, project names, counts, recency, story status), call the list_projects tool before answering.',
    'Before claiming a story node was updated (especially for markdown/google docs story workflows), call sync_story_node first and use the returned sync.resolvedStoryNodeId in your response.',
    'If sync_story_node reports requestedNodeMissing=true, clearly tell the user the previous node ID no longer exists and provide the resolvedStoryNodeId.',
  ],
  capabilities: [
    '1. Create story nodes and prepare project story workspace.',
    '2. Generate character brief nodes from story context.',
    '3. Generate character design/style inspiration nodes.',
    '4. Generate storyboard draft nodes and shot outlines.',
    '5. Keep collaborating through short iterative creative direction.',
  ],
  constraints: [
    'Stay focused on the active project and project-scoped tools for generation tasks.',
  ],
};
