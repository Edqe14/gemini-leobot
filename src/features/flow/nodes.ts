import type { Edge, Node } from '@xyflow/react';

export type CreativeNodeData = {
  label: string;
  description?: string;
};

export const initialNodes: Node<CreativeNodeData>[] = [];

export const initialEdges: Edge[] = [];
