import { Type } from '@google/genai';
import type { AgentDefinition } from './types';
import {
  generateCharacterBriefTool,
  generateCharacterInspirationTool,
  generateStoryboardTool,
  importStoryMarkdownTool,
  listProjectsTool,
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
      name: 'import_story_markdown',
      description:
        'Import or sync story markdown content into the active project. Use when user asks to import story text or Google Docs content.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          markdown: {
            type: Type.STRING,
            description:
              'Optional markdown content to import. If omitted, backend may use project import flow details.',
          },
          sourceUrl: {
            type: Type.STRING,
            description:
              'Optional Google Docs or source URL that contains the story markdown.',
          },
        },
      },
      handler: importStoryMarkdownTool,
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
  ],
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
