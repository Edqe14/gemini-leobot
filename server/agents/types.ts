export type AgentContextKind = 'home' | 'project';

export type AgentInstructionContext = {
  activeSubAgents: string[];
  purpose?: string;
};

export type AgentDefinition = {
  id: AgentContextKind;
  name: 'HomeAgent' | 'ProjectAgent';
  contextDescription: string;
  capabilities: string[];
  constraints: string[];
};
