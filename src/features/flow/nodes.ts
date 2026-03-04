import type { Edge, Node } from '@xyflow/react'

export type CreativeNodeData = {
  label: string
  description?: string
}

export const initialNodes: Node<CreativeNodeData>[] = [
  {
    id: 'story',
    type: 'default',
    position: { x: 200, y: 180 },
    data: {
      label: 'Story',
      description: 'Imported markdown story context',
    },
  },
  {
    id: 'character',
    type: 'default',
    position: { x: 520, y: 100 },
    data: {
      label: 'Character Brief',
      description: 'Generated from story and style',
    },
  },
  {
    id: 'style',
    type: 'default',
    position: { x: 520, y: 300 },
    data: {
      label: 'Design Inspiration',
      description: 'Character design and references',
    },
  },
  {
    id: 'board',
    type: 'default',
    position: { x: 860, y: 200 },
    data: {
      label: 'Storyboard',
      description: 'Shot plan matched to user style',
    },
  },
]

export const initialEdges: Edge[] = [
  { id: 'e-story-character', source: 'story', target: 'character' },
  { id: 'e-story-style', source: 'story', target: 'style' },
  { id: 'e-character-board', source: 'character', target: 'board' },
  { id: 'e-style-board', source: 'style', target: 'board' },
]
