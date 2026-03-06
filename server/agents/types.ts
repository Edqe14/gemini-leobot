import type { FunctionDeclaration } from '@google/genai';

export type AgentContextKind = 'home' | 'project';

export type AgentToolRuntimeEvent = {
  type: string;
  payload?: unknown;
};

export type AgentToolHandlerContext = {
  userId: string;
  projectId?: string;
  args: Record<string, unknown>;
  emitEvent?: (event: AgentToolRuntimeEvent) => void;
};

export type AgentToolHandler = (
  context: AgentToolHandlerContext,
) => Promise<unknown>;

export type AgentToolDefinition = FunctionDeclaration & {
  handler: AgentToolHandler;
};

export type AgentInstructionContext = {
  activeSubAgents: string[];
  purpose?: string;
};

export type AgentDefinition = {
  id: AgentContextKind;
  name: 'HomeAgent' | 'ProjectAgent';
  contextDescription: string;
  toolDeclarations: AgentToolDefinition[];
  toolInstructions: string[];
  capabilities: string[];
  constraints: string[];
};
