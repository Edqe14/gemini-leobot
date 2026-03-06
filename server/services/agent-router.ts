import {
  generateCharacterBriefTool,
  generateCharacterInspirationTool,
  generateStoryboardTool,
  importStoryMarkdownTool,
  listProjectsTool,
} from './tools';

const HOME_CONTEXT_TOOLS = new Set<string>([
  'list_projects',
  // 'create_project' will be added when implemented.
]);

const ACTIVE_PROJECT_TOOLS = new Set<string>([
  'list_projects',
  'import_story_markdown',
  'generate_character_brief',
  'generate_character_inspiration',
  'generate_storyboard',
]);

type AgentToolCallInput = {
  userId: string;
  projectId?: string;
  name: string;
  args?: Record<string, unknown>;
};

export async function handleAgentToolCall(input: AgentToolCallInput) {
  const args = input.args ?? {};
  const hasActiveProject = Boolean(input.projectId?.trim());
  const allowedTools = getAllowedTools(hasActiveProject);

  if (!allowedTools.has(input.name)) {
    return {
      ok: false,
      message: hasActiveProject
        ? `Tool "${input.name}" is not available in active project context.`
        : `Tool "${input.name}" is not available in home context.`,
      context: hasActiveProject ? 'active_project' : 'home',
      allowedTools: [...allowedTools],
    };
  }

  switch (input.name) {
    case 'list_projects':
      return listProjectsTool({
        userId: input.userId,
        projectId: input.projectId,
        args,
      });
    case 'import_story_markdown':
      return importStoryMarkdownTool({
        userId: input.userId,
        projectId: input.projectId,
        args,
      });
    case 'generate_character_brief':
      return generateCharacterBriefTool({
        userId: input.userId,
        projectId: input.projectId,
        args,
      });
    case 'generate_character_inspiration':
      return generateCharacterInspirationTool({
        userId: input.userId,
        projectId: input.projectId,
        args,
      });
    case 'generate_storyboard':
      return generateStoryboardTool({
        userId: input.userId,
        projectId: input.projectId,
        args,
      });
    default:
      return {
        ok: false,
        message: `Unknown tool: ${input.name}`,
      };
  }
}

export function getAllowedTools(hasActiveProject: boolean) {
  return hasActiveProject ? ACTIVE_PROJECT_TOOLS : HOME_CONTEXT_TOOLS;
}

export function getAllowedToolNames(hasActiveProject: boolean) {
  return [...getAllowedTools(hasActiveProject)];
}
