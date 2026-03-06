import { getAllowedToolNamesForContext, runAgentTool } from '../agents';
import type { AgentToolRuntimeEvent } from '../agents/types';

type AgentToolCallInput = {
  userId: string;
  projectId?: string;
  name: string;
  args?: Record<string, unknown>;
  emitEvent?: (event: AgentToolRuntimeEvent) => void;
};

export async function handleAgentToolCall(input: AgentToolCallInput) {
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

  return runAgentTool({
    ...input,
    emitEvent: input.emitEvent,
  });
}

export function getAllowedTools(hasActiveProject: boolean) {
  return new Set(
    getAllowedToolNamesForContext({
      projectId: hasActiveProject ? '__active_project__' : undefined,
    }),
  );
}

export function getAllowedToolNames(hasActiveProject: boolean) {
  return [...getAllowedTools(hasActiveProject)];
}
