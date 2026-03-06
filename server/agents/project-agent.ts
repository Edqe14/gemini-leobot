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
        'Create one or more character brief nodes in the active project, including behavior/style/personality details.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          characters: {
            type: Type.ARRAY,
            description:
              'Preferred batch format. Create one node per character object.',
            items: {
              type: Type.OBJECT,
              properties: {
                name: {
                  type: Type.STRING,
                  description:
                    'Character name (one node per unique character).',
                },
                headImageUrl: {
                  type: Type.STRING,
                  description: 'Optional character head image URL reference.',
                },
                description: {
                  type: Type.STRING,
                  description: 'Character description text.',
                },
                traits: {
                  type: Type.OBJECT,
                  description:
                    'Structured character detail input such as behavior, style, personality, goals, notes, and additional trait fields.',
                  properties: {
                    behavior: {
                      type: Type.STRING,
                      description: 'Behavioral traits and tendencies.',
                    },
                    style: {
                      type: Type.STRING,
                      description: 'Visual style or design direction.',
                    },
                    personality: {
                      type: Type.STRING,
                      description: 'Personality summary.',
                    },
                    goals: {
                      type: Type.STRING,
                      description:
                        'Character goals, motivations, or arc direction.',
                    },
                    notes: {
                      type: Type.STRING,
                      description: 'Additional notes.',
                    },
                  },
                },
              },
            },
          },
          fromStory: {
            type: Type.BOOLEAN,
            description:
              'Optional. If true (default), derive characters from the active story node when no explicit names are provided.',
          },
          maxCharacters: {
            type: Type.NUMBER,
            description:
              'Optional cap when deriving from story node. Allowed range is 1-12.',
          },
          name: {
            type: Type.STRING,
            description:
              'Legacy single-character input: character name to use for the generated node.',
          },
          brief: {
            type: Type.STRING,
            description:
              'Legacy single-character input: character brief markdown content.',
          },
          behavior: {
            type: Type.STRING,
            description:
              'Legacy single-character input: behavioral traits and tendencies.',
          },
          style: {
            type: Type.STRING,
            description:
              'Legacy single-character input: visual style or design direction.',
          },
          personality: {
            type: Type.STRING,
            description: 'Legacy single-character input: personality summary.',
          },
          goals: {
            type: Type.STRING,
            description:
              'Legacy single-character input: goals, motivations, or arc direction.',
          },
          notes: {
            type: Type.STRING,
            description: 'Legacy single-character input: additional notes.',
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
    'When asked to generate character briefs from the story, call generate_character_brief without explicit names (or with fromStory=true) so it derives characters from the active story node.',
    'generate_character_brief derives story-based drafts with a separate non-live completion sub-agent and uses active story markdown as input context.',
    'generate_character_brief returns storyContext (title + markdown). Use it as source-of-truth context when drafting or revising character briefs in follow-up responses.',
    'When deriving characters from story text, include only actors/people participating in events. Exclude product names, tools, platforms, locations, organizations, and other non-character entities.',
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
