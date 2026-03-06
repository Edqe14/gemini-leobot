import { Type } from '@google/genai';
import type { AgentDefinition } from './types';
import {
  createStoryNodeTool,
  generateCharacterDesignTool,
  generateCharacterBriefTool,
  generateCharacterInspirationTool,
  getProjectStyleNodeTool,
  listCharacterNodesTool,
  refineProjectStyleNodeTool,
  generateStoryboardTool,
  updateStoryboardTool,
  listProjectsTool,
  syncStoryNodeTool,
  updateCharacterBriefTool,
  upsertProjectStyleNodeTool,
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
        'Create one or more new character brief nodes in the active project, including behavior/style/personality details.',
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
      name: 'list_character_nodes',
      description:
        'List character nodes in the active project, including characterNodeId and name, so follow-up tools can target exact IDs.',
      handler: listCharacterNodesTool,
    },
    {
      name: 'update_character_brief',
      description:
        'Update an existing character brief node by characterNodeId. Use this for revisions instead of creating a new brief node.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          characterNodeId: {
            type: Type.STRING,
            description: 'Exact character node ID to update. Required.',
          },
          nextName: {
            type: Type.STRING,
            description:
              'Optional new character name if the brief should be renamed.',
          },
          description: {
            type: Type.STRING,
            description: 'Optional description update for the character.',
          },
          brief: {
            type: Type.STRING,
            description:
              'Optional full brief markdown replacement. If omitted, brief text is rebuilt from structured fields.',
          },
          briefMarkdown: {
            type: Type.STRING,
            description:
              'Alias for brief. Optional full brief markdown replacement.',
          },
          headImageUrl: {
            type: Type.STRING,
            description: 'Optional character head image URL update.',
          },
          traits: {
            type: Type.OBJECT,
            description:
              'Optional structured trait updates including behavior/style/personality/goals/notes and extra attributes.',
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
                description: 'Character goals, motivations, or arc direction.',
              },
              notes: {
                type: Type.STRING,
                description: 'Additional notes.',
              },
            },
          },
          behavior: {
            type: Type.STRING,
            description: 'Optional direct behavior field update.',
          },
          style: {
            type: Type.STRING,
            description: 'Optional direct style field update.',
          },
          personality: {
            type: Type.STRING,
            description: 'Optional direct personality field update.',
          },
          goals: {
            type: Type.STRING,
            description: 'Optional direct goals field update.',
          },
          notes: {
            type: Type.STRING,
            description: 'Optional direct notes field update.',
          },
        },
      },
      handler: updateCharacterBriefTool,
    },
    {
      name: 'generate_character_design',
      description:
        'Generate character design image options using Nano Banana (Gemini image model) for all characters or for a specific character by name.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          characterName: {
            type: Type.STRING,
            description:
              'Optional character name. If provided, generate only for this character. If omitted, generate for all character nodes in the active project.',
          },
          optionsCount: {
            type: Type.NUMBER,
            description:
              'Optional number of design options to generate per character. Default is 3. Allowed range is 1-4.',
          },
          replaceExisting: {
            type: Type.BOOLEAN,
            description:
              'Optional. If true (default), replace current options with new ones. If false, append new options.',
          },
        },
      },
      handler: generateCharacterDesignTool,
    },
    {
      name: 'generate_character_inspiration',
      description:
        'Legacy alias. Upsert the canonical project style node based on provided style direction.',
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
      name: 'get_project_style_node',
      description:
        'Get (or initialize) the canonical style node in the active project context.',
      handler: getProjectStyleNodeTool,
    },
    {
      name: 'upsert_project_style_node',
      description:
        'Directly update the canonical project style node for writing style, character style, art style, pacing, and extras.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          writingStyle: {
            type: Type.STRING,
            description:
              'Style direction for prose, tone, and rewrite/retouch language.',
          },
          characterStyle: {
            type: Type.STRING,
            description: 'General character portrayal and voice direction.',
          },
          artStyle: {
            type: Type.STRING,
            description: 'Visual and art-direction style guidance.',
          },
          storytellingPacing: {
            type: Type.STRING,
            description: 'Pacing/rhythm guidance for narrative flow.',
          },
          extras: {
            type: Type.OBJECT,
            description: 'Additional style dimensions as key/value text pairs.',
          },
          styleName: {
            type: Type.STRING,
            description: 'Optional display title for the style node.',
          },
          replace: {
            type: Type.BOOLEAN,
            description:
              'Optional. If true, replace the style payload instead of merging with existing fields.',
          },
        },
      },
      handler: upsertProjectStyleNodeTool,
    },
    {
      name: 'refine_project_style_node',
      description:
        'Refine the canonical style node from a natural-language change request. Large rewrite intent may route through a style sub-agent.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          request: {
            type: Type.STRING,
            description:
              'User request describing how to adjust project style direction.',
          },
          writingStyle: {
            type: Type.STRING,
            description: 'Optional explicit writing style override.',
          },
          characterStyle: {
            type: Type.STRING,
            description: 'Optional explicit character style override.',
          },
          artStyle: {
            type: Type.STRING,
            description: 'Optional explicit art style override.',
          },
          storytellingPacing: {
            type: Type.STRING,
            description: 'Optional explicit storytelling pacing override.',
          },
          extras: {
            type: Type.OBJECT,
            description: 'Optional additional style dimension updates.',
          },
          replace: {
            type: Type.BOOLEAN,
            description:
              'Optional. If true, replace style content instead of merging into current style.',
          },
        },
        required: ['request'],
      },
      handler: refineProjectStyleNodeTool,
    },
    {
      name: 'generate_storyboard',
      description:
        'Generate or refresh storyboard frames for the active project. Reuses the latest storyboard node by default and creates one only when missing.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          storyboardNodeId: {
            type: Type.STRING,
            description:
              'Optional target storyboard node ID. If omitted, the latest storyboard node is updated.',
          },
          title: {
            type: Type.STRING,
            description: 'Storyboard title.',
          },
          frameCount: {
            type: Type.NUMBER,
            description:
              'Optional target frame count (1-24). If omitted, AI chooses based on pacing.',
          },
          autoGenerate: {
            type: Type.BOOLEAN,
            description:
              'Optional. If true (default), generate detailed storyboard frames with AI.',
          },
          shots: {
            type: Type.ARRAY,
            description:
              'Optional prebuilt shot list. Use when providing explicit manual frames.',
            items: {
              type: Type.OBJECT,
            },
          },
          createIfMissing: {
            type: Type.BOOLEAN,
            description:
              'Optional. If true (default), create a storyboard node when none exists.',
          },
        },
      },
      handler: generateStoryboardTool,
    },
    {
      name: 'update_storyboard',
      description:
        'Update an existing storyboard node with regenerated frames and images. Does not create a new storyboard unless createIfMissing is explicitly true.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          storyboardNodeId: {
            type: Type.STRING,
            description:
              'Optional exact storyboard node ID to update. If omitted, updates the latest storyboard node.',
          },
          title: {
            type: Type.STRING,
            description: 'Optional storyboard title update.',
          },
          frameCount: {
            type: Type.NUMBER,
            description:
              'Optional target frame count (1-24). If omitted, AI chooses based on pacing.',
          },
          autoGenerate: {
            type: Type.BOOLEAN,
            description:
              'Optional. If true (default), regenerate detailed storyboard frames with AI.',
          },
          shots: {
            type: Type.ARRAY,
            description:
              'Optional manual shot list to apply before/without regeneration.',
            items: {
              type: Type.OBJECT,
            },
          },
          createIfMissing: {
            type: Type.BOOLEAN,
            description:
              'Optional safety override. Default false for update flow.',
          },
        },
      },
      handler: updateStoryboardTool,
    },
  ],
  toolInstructions: [
    'For factual project/account data (for example: what projects exist, project names, counts, recency, story status), call the list_projects tool before answering.',
    'Before claiming a story node was updated (especially for markdown/google docs story workflows), call sync_story_node first and use the returned sync.resolvedStoryNodeId in your response.',
    'If sync_story_node reports requestedNodeMissing=true, clearly tell the user the previous node ID no longer exists and provide the resolvedStoryNodeId.',
    'When asked to generate character briefs from the story, call generate_character_brief without explicit names (or with fromStory=true) so it derives characters from the active story node.',
    'Before calling update_character_brief, call list_character_nodes to get the exact characterNodeId.',
    'When the user asks to revise or update an existing character brief, call update_character_brief using characterNodeId (not name matching and not generate_character_brief).',
    'generate_character_brief derives story-based drafts with a separate non-live completion sub-agent and uses active story markdown as input context.',
    'generate_character_brief returns storyContext (title + markdown). Use it as source-of-truth context when drafting or revising character briefs in follow-up responses.',
    'When deriving characters from story text, include only actors/people participating in events. Exclude product names, tools, platforms, locations, organizations, and other non-character entities.',
    'When the user asks generally for character designs (for example: "generate all character designs"), call generate_character_design without characterName so it runs for all character nodes.',
    'When the user asks for a specific character design (for example: "generate character design for Maya"), call generate_character_design with characterName set to that character only.',
    'generate_character_design requires existing character nodes. If there are none, clearly tell the user to create/import character nodes first.',
    'Style direction is project context. Resolve canonical style state with get_project_style_node before major rewrite/retouch guidance.',
    'When the user asks to create/update/adjust style guidance, always execute a mutating style tool (upsert_project_style_node or refine_project_style_node) before responding.',
    'For direct field-level edits (for example: only set writingStyle/artStyle text exactly), call upsert_project_style_node.',
    'For natural-language style generation or refinement requests, call refine_project_style_node so professional multi-discipline style synthesis runs across the whole project scope.',
    'After style updates, summarize what changed in writingStyle, characterStyle, artStyle, and storytellingPacing.',
    'Before generate_storyboard or update_storyboard, ensure story content exists (sync_story_node when needed) so frame generation has source narrative context.',
    'When the user asks to revise an existing storyboard, call update_storyboard (not generate_storyboard) so the current storyboard node is updated in place.',
    'Storyboard generation should use project style direction and character design context to produce detailed, actionable frame descriptions.',
  ],
  capabilities: [
    '1. Create story nodes and prepare project story workspace.',
    '2. Generate character brief nodes from story context.',
    '3. Generate character design image options from character + style nodes.',
    '3a. Generate character design/style inspiration nodes.',
    '3b. Maintain one evolving project style node for writing, character, art, pacing, and extra style dimensions.',
    '4. Generate storyboard draft nodes and shot outlines.',
    '5. Keep collaborating through short iterative creative direction.',
  ],
  constraints: [
    'Stay focused on the active project and project-scoped tools for generation tasks.',
  ],
};
