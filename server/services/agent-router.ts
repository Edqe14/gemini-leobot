import {
  generateCharacterBriefTool,
  generateCharacterInspirationTool,
  generateStoryboardTool,
  importStoryMarkdownTool,
} from './tools'

type AgentToolCallInput = {
  userId: string
  projectId?: string
  name: string
  args?: Record<string, unknown>
}

export async function handleAgentToolCall(input: AgentToolCallInput) {
  const args = input.args ?? {}

  switch (input.name) {
    case 'import_story_markdown':
      return importStoryMarkdownTool({ userId: input.userId, projectId: input.projectId, args })
    case 'generate_character_brief':
      return generateCharacterBriefTool({ userId: input.userId, projectId: input.projectId, args })
    case 'generate_character_inspiration':
      return generateCharacterInspirationTool({ userId: input.userId, projectId: input.projectId, args })
    case 'generate_storyboard':
      return generateStoryboardTool({ userId: input.userId, projectId: input.projectId, args })
    default:
      return {
        ok: false,
        message: `Unknown tool: ${input.name}`,
      }
  }
}
