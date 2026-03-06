import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  type Edge,
  Position,
  type NodeChange,
  type NodePositionChange,
  type Node,
  type NodeProps,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import { Captions, CaptionsOff, Mic, MicOff, User } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AuthGate } from '@/components/auth-gate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  initialEdges,
  initialNodes,
  type CreativeNodeData,
} from '@/features/flow/nodes';
import { createAgentSocket } from '@/lib/ws-client';

import '@xyflow/react/dist/style.css';

type DebugMonitorResponse = {
  monitor?: {
    enabled?: boolean;
  };
};

type AudioChunk = {
  mimeType: string;
  data: string;
};

type VoiceState = 'idle' | 'active';

type CaptionSpeaker = 'You' | 'Leo';

type CaptionLine = {
  speaker: CaptionSpeaker;
  text: string;
};

type StoryRecord = {
  id: string;
  title: string;
  markdown: string;
  sourceDocUrl?: string | null;
  positionX?: number | null;
  positionY?: number | null;
};

type CharacterNodeRecord = {
  id: string;
  name: string;
  briefMarkdown: string;
  profileJson?: string | null;
  positionX?: number | null;
  positionY?: number | null;
};

type CharacterProfileRecord = {
  description?: string;
  headImageUrl?: string;
  behavior?: string;
  style?: string;
  personality?: string;
  goals?: string;
  notes?: string;
  attributes?: Record<string, string>;
};

type StyleNodeRecord = {
  id: string;
  name: string;
  description: string;
  writingStyle?: string | null;
  characterStyle?: string | null;
  artStyle?: string | null;
  storytellingPacing?: string | null;
  extrasJson?: string | null;
  positionX?: number | null;
  positionY?: number | null;
};

type StoryboardNodeRecord = {
  id: string;
  title: string;
  positionX?: number | null;
  positionY?: number | null;
};

type ProjectGraphRecord = {
  id: string;
  name?: string;
  story?: StoryRecord | null;
  characterNodes?: CharacterNodeRecord[];
  styleNodes?: StyleNodeRecord[];
  storyboardNodes?: StoryboardNodeRecord[];
};

type ProjectDetailsResponse = {
  project?: ProjectGraphRecord;
};

type StoryImportResponse = {
  story?: StoryRecord;
  error?: string;
};

type CharacterSaveState = 'idle' | 'saving' | 'saved' | 'error';

type CharacterNodeUpdateResponse = {
  ok?: boolean;
  node?: CharacterNodeRecord;
  error?: string;
};

type StyleSaveState = 'idle' | 'saving' | 'saved' | 'error';

type StyleDraftState = {
  name: string;
  writingStyle: string;
  characterStyle: string;
  artStyle: string;
  storytellingPacing: string;
  extrasText: string;
  saveState: StyleSaveState;
  saveMessage?: string;
};

type StyleNodeUpdateResponse = {
  ok?: boolean;
  node?: StyleNodeRecord;
  error?: string;
};

const CANVAS_GRID_START_X = 80;
const CANVAS_GRID_START_Y = 120;
const CANVAS_GRID_STEP_X = 360;
const CANVAS_GRID_STEP_Y = 220;
const CANVAS_GRID_MAX_COLUMNS = 8;
const CANVAS_GRID_MAX_ROWS = 200;

function getGridCellKey(position: { x: number; y: number }) {
  const col = Math.max(
    0,
    Math.round((position.x - CANVAS_GRID_START_X) / CANVAS_GRID_STEP_X),
  );
  const row = Math.max(
    0,
    Math.round((position.y - CANVAS_GRID_START_Y) / CANVAS_GRID_STEP_Y),
  );

  return `${col}:${row}`;
}

function reserveGridCell(
  occupiedCells: Set<string>,
  position: { x: number; y: number },
) {
  const key = getGridCellKey(position);
  if (occupiedCells.has(key)) {
    return false;
  }

  occupiedCells.add(key);
  return true;
}

function allocateNextGridPosition(occupiedCells: Set<string>) {
  for (let row = 0; row < CANVAS_GRID_MAX_ROWS; row += 1) {
    for (let col = 0; col < CANVAS_GRID_MAX_COLUMNS; col += 1) {
      const key = `${col}:${row}`;
      if (occupiedCells.has(key)) {
        continue;
      }

      occupiedCells.add(key);
      return {
        x: CANVAS_GRID_START_X + col * CANVAS_GRID_STEP_X,
        y: CANVAS_GRID_START_Y + row * CANVAS_GRID_STEP_Y,
      };
    }
  }

  const fallbackRow = CANVAS_GRID_MAX_ROWS + occupiedCells.size;
  return {
    x: CANVAS_GRID_START_X,
    y: CANVAS_GRID_START_Y + fallbackRow * CANVAS_GRID_STEP_Y,
  };
}

type CharacterDraftState = {
  name: string;
  description: string;
  traitsText: string;
  saveState: CharacterSaveState;
  saveMessage?: string;
};

type StoryImportMode = 'markdown' | 'google_docs';

type StoryImportNodeData = {
  activeProjectId: string;
  hasIncomingConnection: boolean;
  mode: StoryImportMode;
  markdownInput: string;
  googleDocUrl: string;
  busy: boolean;
  status: string;
  error: string;
  onModeChange: (mode: StoryImportMode) => void;
  onMarkdownChange: (value: string) => void;
  onGoogleDocUrlChange: (value: string) => void;
  onSave: () => void;
  onFetchGoogleDocs: () => void;
};

type CharacterCardNodeData = {
  characterId: string;
  hasIncomingConnection: boolean;
  name: string;
  description: string;
  traitsText: string;
  saveState: CharacterSaveState;
  saveMessage?: string;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onTraitsChange: (value: string) => void;
};

type StyleCardNodeData = {
  styleId: string;
  hasOutgoingConnection: boolean;
  name: string;
  writingStyle: string;
  characterStyle: string;
  artStyle: string;
  storytellingPacing: string;
  extrasText: string;
  saveState: StyleSaveState;
  saveMessage?: string;
  onNameChange: (value: string) => void;
  onWritingStyleChange: (value: string) => void;
  onCharacterStyleChange: (value: string) => void;
  onArtStyleChange: (value: string) => void;
  onStorytellingPacingChange: (value: string) => void;
  onExtrasTextChange: (value: string) => void;
};

type CanvasNodeData =
  | CreativeNodeData
  | StoryImportNodeData
  | CharacterCardNodeData
  | StyleCardNodeData;
type StoryImportCanvasNode = Node<StoryImportNodeData, 'storyImport'>;
type CharacterCardCanvasNode = Node<CharacterCardNodeData, 'characterCard'>;
type StyleCardCanvasNode = Node<StyleCardNodeData, 'styleCard'>;

type PendingContextSwitch = {
  projectId: string;
  projectName?: string;
  assistantAudioStarted: boolean;
  signalExtended: boolean;
  requestedAt: number;
  deadlineAt: number;
};

const CAPTION_IDLE_CLEAR_MS = 10000;
const CONTEXT_SWITCH_RETRY_MS = 320;
const CONTEXT_SWITCH_TIMEOUT_MS = 8000;
const CONTEXT_SWITCH_HARD_TIMEOUT_MS = 12000;
const CONTEXT_SWITCH_SIGNAL_EXTENSION_MS = 4000;

type HandleSide = 'top' | 'right' | 'bottom' | 'left';

function getSourceHandleId(side: HandleSide) {
  return `style-source-${side}`;
}

function getTargetHandleId(side: HandleSide) {
  return `target-${side}`;
}

function getNearestHandleSides(input: {
  source: { x: number; y: number };
  target: { x: number; y: number };
}) {
  const dx = input.target.x - input.source.x;
  const dy = input.target.y - input.source.y;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? ({ source: 'right', target: 'left' } as const)
      : ({ source: 'left', target: 'right' } as const);
  }

  return dy >= 0
    ? ({ source: 'bottom', target: 'top' } as const)
    : ({ source: 'top', target: 'bottom' } as const);
}

function getProjectIdFromSearch(search: string) {
  const projectId = new URLSearchParams(search).get('projectId');
  return projectId?.trim() || '';
}

function StoryImportNodeComponent({ data }: NodeProps<StoryImportCanvasNode>) {
  const nodeData = data;

  return (
    <Card className='relative w-200 border border-border/80 bg-card/95 p-4 shadow-sm backdrop-blur'>
      {nodeData.hasIncomingConnection ? (
        <>
          <Handle
            type='target'
            id={getTargetHandleId('top')}
            position={Position.Top}
            className='!h-3 !w-3 !border !border-border !bg-background'
          />
          <Handle
            type='target'
            id={getTargetHandleId('right')}
            position={Position.Right}
            className='!h-3 !w-3 !border !border-border !bg-background'
          />
          <Handle
            type='target'
            id={getTargetHandleId('bottom')}
            position={Position.Bottom}
            className='!h-3 !w-3 !border !border-border !bg-background'
          />
          <Handle
            type='target'
            id={getTargetHandleId('left')}
            position={Position.Left}
            className='!h-3 !w-3 !border !border-border !bg-background'
          />
        </>
      ) : null}
      <div className='mb-3 flex items-center justify-between gap-3'>
        <p className='text-sm font-semibold'>Import Story</p>
        <Badge variant='outline'>
          project {nodeData.activeProjectId ? 'ready' : 'unset'}
        </Badge>
      </div>

      <div className='mb-3 flex items-center gap-2'>
        <Button
          type='button'
          variant='outline'
          className={`nodrag h-8 min-w-28 px-3 text-xs ${
            nodeData.mode === 'markdown'
              ? 'border-border bg-secondary text-foreground'
              : 'border-border bg-background text-muted-foreground'
          }`}
          onClick={() => nodeData.onModeChange('markdown')}>
          Markdown
        </Button>
        <Button
          type='button'
          variant='outline'
          className={`nodrag h-8 min-w-28 px-3 text-xs ${
            nodeData.mode === 'google_docs'
              ? 'border-border bg-secondary text-foreground'
              : 'border-border bg-background text-muted-foreground'
          }`}
          onClick={() => nodeData.onModeChange('google_docs')}>
          Google Docs
        </Button>
      </div>

      {nodeData.mode === 'markdown' ? (
        <div className='space-y-3'>
          <textarea
            value={nodeData.markdownInput}
            onChange={(event) => nodeData.onMarkdownChange(event.target.value)}
            placeholder='Paste your markdown story here...'
            className='nodrag nowheel nopan h-64 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm'
          />
          <Button
            type='button'
            className='nodrag w-full bg-primary/90 text-primary-foreground hover:bg-primary'
            disabled={nodeData.busy || !nodeData.activeProjectId.trim()}
            onClick={nodeData.onSave}>
            {nodeData.busy ? 'Saving...' : 'Save Story'}
          </Button>
        </div>
      ) : (
        <div className='space-y-3'>
          <input
            type='url'
            value={nodeData.googleDocUrl}
            onChange={(event) =>
              nodeData.onGoogleDocUrlChange(event.target.value)
            }
            placeholder='https://docs.google.com/document/d/...'
            className='nodrag nowheel nopan h-10 w-full rounded-md border border-input bg-background px-3 text-sm'
          />
          <Button
            type='button'
            className='nodrag w-full bg-primary/90 text-primary-foreground hover:bg-primary'
            disabled={nodeData.busy || !nodeData.activeProjectId.trim()}
            onClick={nodeData.onFetchGoogleDocs}>
            {nodeData.busy ? 'Fetching...' : 'Fetch From Google Docs'}
          </Button>
        </div>
      )}

      {nodeData.status ? (
        <p className='mt-2 text-xs text-muted-foreground'>{nodeData.status}</p>
      ) : null}
      {nodeData.error ? (
        <p className='mt-2 text-xs text-destructive'>{nodeData.error}</p>
      ) : null}
    </Card>
  );
}

function CharacterCardNodeComponent({
  data,
}: NodeProps<CharacterCardCanvasNode>) {
  return (
    <Card className='relative w-115 border border-border/90 bg-card p-4 shadow-sm'>
      {data.hasIncomingConnection ? (
        <>
          <Handle
            type='target'
            id={getTargetHandleId('top')}
            position={Position.Top}
            className='!h-3 !w-3 !border !border-border !bg-background'
          />
          <Handle
            type='target'
            id={getTargetHandleId('right')}
            position={Position.Right}
            className='!h-3 !w-3 !border !border-border !bg-background'
          />
          <Handle
            type='target'
            id={getTargetHandleId('bottom')}
            position={Position.Bottom}
            className='!h-3 !w-3 !border !border-border !bg-background'
          />
          <Handle
            type='target'
            id={getTargetHandleId('left')}
            position={Position.Left}
            className='!h-3 !w-3 !border !border-border !bg-background'
          />
        </>
      ) : null}
      <div className='space-y-3'>
        <div className='rounded-xl border border-border bg-background px-4 py-3'>
          <input
            value={data.name}
            onChange={(event) => data.onNameChange(event.target.value)}
            placeholder='Character name'
            className='nodrag nowheel nopan w-full border-0 bg-transparent text-center text-lg font-semibold leading-tight outline-none'
          />
        </div>
        <div className='min-h-22 rounded-xl border border-border bg-background px-4 py-3'>
          <textarea
            value={data.description}
            onChange={(event) => data.onDescriptionChange(event.target.value)}
            placeholder='Short description of who this character is'
            className='nodrag nowheel nopan min-h-16 w-full resize-y border-0 bg-transparent text-sm leading-snug text-foreground/90 outline-none'
          />
        </div>
      </div>

      <div className='mt-4 min-h-52 rounded-xl border border-border bg-background px-4 py-4'>
        <p className='mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
          Character Traits, Behaviour, Style
        </p>
        <textarea
          value={data.traitsText}
          onChange={(event) => data.onTraitsChange(event.target.value)}
          placeholder='Behavior: ...\nStyle: ...\nPersonality: ...\nGoals: ...\nNotes: ...'
          className='nodrag nowheel nopan min-h-44 w-full resize-y border-0 bg-transparent font-mono text-sm leading-relaxed text-foreground/90 outline-none'
        />
      </div>

      <div className='mt-3 flex justify-end'>
        <p className='text-xs text-muted-foreground'>
          {data.saveState === 'saving'
            ? 'Saving...'
            : data.saveState === 'saved'
              ? 'Saved'
              : data.saveState === 'error'
                ? data.saveMessage || 'Save failed'
                : data.saveMessage || 'Autosave'}
        </p>
      </div>
    </Card>
  );
}

function StyleCardNodeComponent({ data }: NodeProps<StyleCardCanvasNode>) {
  return (
    <Card className='relative w-130 border border-border/90 bg-card p-4 shadow-sm'>
      {data.hasOutgoingConnection ? (
        <>
          <Handle
            type='source'
            id={getSourceHandleId('top')}
            position={Position.Top}
            className='!h-3 !w-3 !border !border-border !bg-foreground/80'
          />
          <Handle
            type='source'
            id={getSourceHandleId('right')}
            position={Position.Right}
            className='!h-3 !w-3 !border !border-border !bg-foreground/80'
          />
          <Handle
            type='source'
            id={getSourceHandleId('bottom')}
            position={Position.Bottom}
            className='!h-3 !w-3 !border !border-border !bg-foreground/80'
          />
          <Handle
            type='source'
            id={getSourceHandleId('left')}
            position={Position.Left}
            className='!h-3 !w-3 !border !border-border !bg-foreground/80'
          />
        </>
      ) : null}
      <div className='space-y-3'>
        <div className='px-2 py-1'>
          <p className='text-center text-2xl font-semibold leading-tight tracking-tight'>
            {data.name || 'Project Style Guide'}
          </p>
        </div>
        <div className='grid gap-3'>
          <div className='rounded-xl border border-border bg-background px-4 py-3'>
            <p className='mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
              Writing Style
            </p>
            <textarea
              value={data.writingStyle}
              onChange={(event) =>
                data.onWritingStyleChange(event.target.value)
              }
              placeholder='Rewrite/retouch voice, diction, tone, and narration style.'
              className='nodrag nowheel nopan min-h-18 w-full resize-y border-0 bg-transparent text-sm leading-relaxed text-foreground/90 outline-none'
            />
          </div>
          <div className='rounded-xl border border-border bg-background px-4 py-3'>
            <p className='mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
              Character Style
            </p>
            <textarea
              value={data.characterStyle}
              onChange={(event) =>
                data.onCharacterStyleChange(event.target.value)
              }
              placeholder='General character portrayal, voice consistency, and behavior framing.'
              className='nodrag nowheel nopan min-h-18 w-full resize-y border-0 bg-transparent text-sm leading-relaxed text-foreground/90 outline-none'
            />
          </div>
          <div className='rounded-xl border border-border bg-background px-4 py-3'>
            <p className='mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
              Art Style
            </p>
            <textarea
              value={data.artStyle}
              onChange={(event) => data.onArtStyleChange(event.target.value)}
              placeholder='Visual language, camera mood, palette, and art direction.'
              className='nodrag nowheel nopan min-h-18 w-full resize-y border-0 bg-transparent text-sm leading-relaxed text-foreground/90 outline-none'
            />
          </div>
          <div className='rounded-xl border border-border bg-background px-4 py-3'>
            <p className='mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
              Storytelling Pacing
            </p>
            <textarea
              value={data.storytellingPacing}
              onChange={(event) =>
                data.onStorytellingPacingChange(event.target.value)
              }
              placeholder='Rhythm, beat spacing, tension curve, and cadence guidance.'
              className='nodrag nowheel nopan min-h-18 w-full resize-y border-0 bg-transparent text-sm leading-relaxed text-foreground/90 outline-none'
            />
          </div>
          <div className='rounded-xl border border-border bg-background px-4 py-3'>
            <p className='mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
              Additional Style Dimensions
            </p>
            <textarea
              value={data.extrasText}
              onChange={(event) => data.onExtrasTextChange(event.target.value)}
              placeholder={
                'Humor: dry and situational\nDialogue density: sparse but sharp'
              }
              className='nodrag nowheel nopan min-h-20 w-full resize-y border-0 bg-transparent font-mono text-sm leading-relaxed text-foreground/90 outline-none'
            />
          </div>
        </div>
      </div>

      <div className='mt-3 flex justify-end'>
        <p className='text-xs text-muted-foreground'>
          {data.saveState === 'saving'
            ? 'Saving...'
            : data.saveState === 'saved'
              ? 'Saved'
              : data.saveState === 'error'
                ? data.saveMessage || 'Save failed'
                : data.saveMessage || 'Autosave'}
        </p>
      </div>
    </Card>
  );
}

function mergeCaptionText(previous: string, incoming: string): string {
  const prev = previous.trim();
  const next = incoming.trim();

  if (!next) {
    return prev;
  }

  if (!prev) {
    return next;
  }

  if (next === prev || prev.endsWith(` ${next}`)) {
    return prev;
  }

  if (next.startsWith(prev) || prev.startsWith(next)) {
    return next;
  }

  if (/^[.,!?;:]+$/.test(next)) {
    return `${prev}${next}`;
  }

  return `${prev} ${next}`;
}

function parseCharacterProfile(profileJson?: string | null) {
  if (!profileJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(profileJson);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    return parsed as CharacterProfileRecord;
  } catch {
    return null;
  }
}

function buildCharacterTraitsText(profile: CharacterProfileRecord | null) {
  if (!profile) {
    return '';
  }

  const lines = [
    ['Behavior', profile.behavior],
    ['Style', profile.style],
    ['Personality', profile.personality],
    ['Goals', profile.goals],
    ['Notes', profile.notes],
  ]
    .filter(([, value]) => typeof value === 'string' && value.trim())
    .map(([label, value]) => `${label}: ${String(value).trim()}`);

  if (profile.attributes && typeof profile.attributes === 'object') {
    Object.entries(profile.attributes).forEach(([key, value]) => {
      const normalizedKey = key.trim();
      const normalizedValue = String(value ?? '').trim();
      if (!normalizedKey || !normalizedValue) {
        return;
      }

      lines.push(`${normalizedKey}: ${normalizedValue}`);
    });
  }

  return lines.join('\n');
}

function extractCharacterDescription(
  briefMarkdown: string,
  profile: CharacterProfileRecord | null,
) {
  if (profile?.description && profile.description.trim()) {
    return profile.description.trim();
  }

  const normalized = briefMarkdown.trim();
  if (!normalized) {
    return '';
  }

  const firstParagraph = normalized.split(/\n\s*\n/)[0] ?? '';
  const cleaned = firstParagraph
    .split('\n')
    .filter((line) => !line.trim().startsWith('- **'))
    .join(' ')
    .trim();

  return cleaned;
}

function buildCharacterDraftFromRecord(character: CharacterNodeRecord) {
  const profile = parseCharacterProfile(character.profileJson);

  return {
    name: character.name,
    description: extractCharacterDescription(character.briefMarkdown, profile),
    traitsText: buildCharacterTraitsText(profile),
  };
}

function parseStyleExtrasJson(extrasJson?: string | null) {
  if (!extrasJson) {
    return {} as Record<string, string>;
  }

  try {
    const parsed = JSON.parse(extrasJson);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {} as Record<string, string>;
    }

    const extras: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const normalizedKey = key.trim();
      const normalizedValue = String(value ?? '').trim();
      if (!normalizedKey || !normalizedValue) {
        continue;
      }

      extras[normalizedKey] = normalizedValue;
    }

    return extras;
  } catch {
    return {} as Record<string, string>;
  }
}

function buildStyleExtrasText(extras: Record<string, string>) {
  return Object.entries(extras)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
}

function buildStyleDraftFromRecord(
  styleNode: StyleNodeRecord,
): StyleDraftState {
  return {
    name: styleNode.name || 'Project Style Guide',
    writingStyle: styleNode.writingStyle?.trim() || '',
    characterStyle: styleNode.characterStyle?.trim() || '',
    artStyle: styleNode.artStyle?.trim() || '',
    storytellingPacing: styleNode.storytellingPacing?.trim() || '',
    extrasText: buildStyleExtrasText(
      parseStyleExtrasJson(styleNode.extrasJson),
    ),
    saveState: 'idle',
    saveMessage: 'Autosave',
  };
}

function updateCaptionLines(
  current: CaptionLine[],
  speaker: CaptionSpeaker,
  text: string,
): CaptionLine[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return current;
  }

  const next = [...current];
  const last = next[next.length - 1];

  if (!last || last.speaker !== speaker) {
    next.push({ speaker, text: trimmed });
    return next.slice(-12);
  }

  const merged = mergeCaptionText(last.text, trimmed);
  if (merged === last.text) {
    return next;
  }

  next[next.length - 1] = { speaker, text: merged };
  return next.slice(-12);
}

function extractAudioChunks(payload: unknown): AudioChunk[] {
  const chunks: AudioChunk[] = [];

  const walk = (value: unknown) => {
    if (!value || typeof value !== 'object') {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }

    const record = value as Record<string, unknown>;
    const mimeType = record.mimeType;
    const data = record.data;

    if (
      typeof mimeType === 'string' &&
      typeof data === 'string' &&
      mimeType.toLowerCase().startsWith('audio/')
    ) {
      chunks.push({ mimeType, data });
      return;
    }

    Object.values(record).forEach(walk);
  };

  walk(payload);
  return chunks;
}

const StoryImportNode = memo(StoryImportNodeComponent);
const CharacterCardNode = memo(CharacterCardNodeComponent);
const StyleCardNode = memo(StyleCardNodeComponent);
const FLOW_NODE_TYPES = {
  storyImport: StoryImportNode,
  characterCard: CharacterCardNode,
  styleCard: StyleCardNode,
};

function extractOutputTranscription(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const serverContent = record.serverContent;
  if (!serverContent || typeof serverContent !== 'object') {
    return null;
  }

  const contentRecord = serverContent as Record<string, unknown>;
  const outputTranscription = contentRecord.outputTranscription;
  if (!outputTranscription || typeof outputTranscription !== 'object') {
    return null;
  }

  const text = (outputTranscription as Record<string, unknown>).text;
  return typeof text === 'string' && text.trim() ? text.trim() : null;
}

function extractInputTranscription(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const serverContent = record.serverContent;
  if (!serverContent || typeof serverContent !== 'object') {
    return null;
  }

  const contentRecord = serverContent as Record<string, unknown>;
  const inputTranscription = contentRecord.inputTranscription;
  if (!inputTranscription || typeof inputTranscription !== 'object') {
    return null;
  }

  const text = (inputTranscription as Record<string, unknown>).text;
  return typeof text === 'string' && text.trim() ? text.trim() : null;
}

function extractVoiceState(payload: unknown): VoiceState | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const voiceActivity = record.voiceActivity;
  if (!voiceActivity || typeof voiceActivity !== 'object') {
    const vadSignal = record.voiceActivityDetectionSignal;
    if (!vadSignal || typeof vadSignal !== 'object') {
      return null;
    }

    const vadSignalType = (vadSignal as Record<string, unknown>).vadSignalType;
    if (vadSignalType === 'VAD_SIGNAL_TYPE_SOS') {
      return 'active';
    }

    if (vadSignalType === 'VAD_SIGNAL_TYPE_EOS') {
      return 'idle';
    }

    return null;
  }

  const voiceActivityType = (voiceActivity as Record<string, unknown>)
    .voiceActivityType;
  if (voiceActivityType === 'ACTIVITY_START') {
    return 'active';
  }

  if (voiceActivityType === 'ACTIVITY_END') {
    return 'idle';
  }

  return null;
}

function parsePcmRate(mimeType: string): number {
  const match = /rate=(\d+)/i.exec(mimeType);
  if (!match) {
    return 24000;
  }

  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 24000;
  }

  return parsed;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const tagName = target.tagName;
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
}

function base64ToPcm16(base64Data: string): Int16Array {
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Int16Array(bytes.buffer);
}

function pcm16ToAudioBuffer(
  context: AudioContext,
  pcm16: Int16Array,
  sampleRate: number,
): AudioBuffer {
  const float32 = new Float32Array(pcm16.length);
  for (let index = 0; index < pcm16.length; index += 1) {
    float32[index] = pcm16[index] / 0x8000;
  }

  const buffer = context.createBuffer(1, float32.length, sampleRate);
  buffer.copyToChannel(float32, 0);
  return buffer;
}

export function CanvasPage() {
  return (
    <AuthGate>
      {({ userName }) => (
        <ReactFlowProvider>
          <CreativeAgentCanvas userName={userName} />
        </ReactFlowProvider>
      )}
    </AuthGate>
  );
}

function CreativeAgentCanvas({ userName }: { userName: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<CanvasNodeData>>(
    initialNodes as Node<CanvasNodeData>[],
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [micActive, setMicActive] = useState(false);
  const [micError, setMicError] = useState('');
  const [connected, setConnected] = useState(false);
  const [socketStatus, setSocketStatus] = useState(
    'connecting voice socket...',
  );
  const [sentChunks, setSentChunks] = useState(0);
  const [ingestedChunks, setIngestedChunks] = useState(0);
  const [debugOverlayEnabled, setDebugOverlayEnabled] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [loopbackEnabled, setLoopbackEnabled] = useState(false);
  const [ccEnabled, setCcEnabled] = useState(true);
  const [captionLines, setCaptionLines] = useState<CaptionLine[]>([]);
  const [showInterruptedBadge, setShowInterruptedBadge] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState(() =>
    getProjectIdFromSearch(window.location.search),
  );
  const [projectName, setProjectName] = useState<string>('No active project');
  const [storyImportMode, setStoryImportMode] =
    useState<StoryImportMode>('markdown');
  const [storyMarkdownInput, setStoryMarkdownInput] = useState('');
  const [storyGoogleDocUrl, setStoryGoogleDocUrl] = useState('');
  const [storyImportBusy, setStoryImportBusy] = useState(false);
  const [storyImportStatus, setStoryImportStatus] = useState('');
  const [storyImportError, setStoryImportError] = useState('');
  const [projectGraph, setProjectGraph] = useState<ProjectGraphRecord | null>(
    null,
  );
  const [projectGraphRefreshToken, setProjectGraphRefreshToken] = useState(0);
  const [characterDrafts, setCharacterDrafts] = useState<
    Record<string, CharacterDraftState>
  >({});
  const [styleDrafts, setStyleDrafts] = useState<
    Record<string, StyleDraftState>
  >({});
  const [debugTextInput, setDebugTextInput] = useState('');
  const initialProjectIdRef = useRef(activeProjectId);
  const activeProjectIdRef = useRef(activeProjectId);
  const socketClientRef = useRef<ReturnType<typeof createAgentSocket> | null>(
    null,
  );
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const sinkGainNodeRef = useRef<GainNode | null>(null);
  const loopbackGainNodeRef = useRef<GainNode | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const playbackCursorRef = useRef(0);
  const playbackSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const interruptedBadgeTimerRef = useRef<number | null>(null);
  const captionClearTimerRef = useRef<number | null>(null);
  const pendingContextSwitchRef = useRef<PendingContextSwitch | null>(null);
  const pendingContextSwitchTimerRef = useRef<number | null>(null);
  const characterAutosaveTimersRef = useRef<Map<string, number>>(new Map());
  const styleAutosaveTimersRef = useRef<Map<string, number>>(new Map());
  const nodePositionSaveTimersRef = useRef<Map<string, number>>(new Map());
  const lastSavedNodePositionsRef = useRef<
    Record<string, { x: number; y: number }>
  >({});
  const characterDraftsRef = useRef<Record<string, CharacterDraftState>>({});
  const styleDraftsRef = useRef<Record<string, StyleDraftState>>({});
  const nodesRef = useRef<Node<CanvasNodeData>[]>([]);
  const micActiveRef = useRef(false);
  const micStartingRef = useRef(false);
  const pttHeldRef = useRef(false);
  const pttMicActivatedRef = useRef(false);

  const clearPendingContextSwitchTimer = useCallback(() => {
    if (pendingContextSwitchTimerRef.current) {
      window.clearTimeout(pendingContextSwitchTimerRef.current);
      pendingContextSwitchTimerRef.current = null;
    }
  }, []);

  const flushPendingContextSwitch = useCallback(() => {
    const pending = pendingContextSwitchRef.current;
    if (!pending || !socketClientRef.current) {
      return;
    }

    socketClientRef.current.send({
      type: 'agent.context',
      payload: {
        projectId: pending.projectId,
        projectName: pending.projectName,
      },
    });

    pendingContextSwitchRef.current = null;
    clearPendingContextSwitchTimer();
  }, [clearPendingContextSwitchTimer]);

  const schedulePendingContextSwitchCheck = useCallback(() => {
    clearPendingContextSwitchTimer();

    pendingContextSwitchTimerRef.current = window.setTimeout(() => {
      const pending = pendingContextSwitchRef.current;
      if (!pending) {
        return;
      }

      if (pending.assistantAudioStarted) {
        if (playbackSourcesRef.current.size > 0) {
          schedulePendingContextSwitchCheck();
          return;
        }

        flushPendingContextSwitch();
        return;
      }

      const timedOut = Date.now() >= pending.deadlineAt;
      if (!timedOut) {
        schedulePendingContextSwitchCheck();
        return;
      }

      flushPendingContextSwitch();
    }, CONTEXT_SWITCH_RETRY_MS);
  }, [clearPendingContextSwitchTimer, flushPendingContextSwitch]);

  const interruptPlayback = useCallback(() => {
    const activeSources = playbackSourcesRef.current;
    let didInterrupt = false;

    if (activeSources.size > 0) {
      didInterrupt = true;
      for (const source of activeSources) {
        try {
          source.stop();
        } catch {
          // no-op
        }
        source.disconnect();
      }
      activeSources.clear();
    }

    const playbackContext = playbackContextRef.current;
    if (playbackContext) {
      playbackCursorRef.current = playbackContext.currentTime;
    }

    return didInterrupt;
  }, []);

  const notifyInterrupted = useCallback(() => {
    setShowInterruptedBadge(true);
    if (interruptedBadgeTimerRef.current) {
      window.clearTimeout(interruptedBadgeTimerRef.current);
    }

    interruptedBadgeTimerRef.current = window.setTimeout(() => {
      setShowInterruptedBadge(false);
      interruptedBadgeTimerRef.current = null;
    }, 1200);
  }, []);

  useEffect(() => {
    let mounted = true;

    void fetch('/api/debug/monitor', { credentials: 'include' })
      .then((response) => {
        if (!response.ok) {
          return null;
        }

        return response.json() as Promise<DebugMonitorResponse>;
      })
      .then((payload) => {
        if (!mounted || !payload) {
          return;
        }

        setDebugOverlayEnabled(Boolean(payload.monitor?.enabled));
      })
      .catch(() => {
        if (mounted) {
          setDebugOverlayEnabled(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (captionClearTimerRef.current) {
      window.clearTimeout(captionClearTimerRef.current);
      captionClearTimerRef.current = null;
    }

    if (!captionLines.length) {
      return;
    }

    captionClearTimerRef.current = window.setTimeout(() => {
      setCaptionLines([]);
      captionClearTimerRef.current = null;
    }, CAPTION_IDLE_CLEAR_MS);
  }, [captionLines]);

  useEffect(() => {
    activeProjectIdRef.current = activeProjectId;
  }, [activeProjectId]);

  useEffect(() => {
    characterDraftsRef.current = characterDrafts;
  }, [characterDrafts]);

  useEffect(() => {
    styleDraftsRef.current = styleDrafts;
  }, [styleDrafts]);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const buildAutoStyleEdges = useCallback(
    (canvasNodes: Node<CanvasNodeData>[]) => {
      if (!projectGraph) {
        return [] as Edge[];
      }

      const edges: Edge[] = [];
      const styleNodeIds = (projectGraph.styleNodes ?? []).map(
        (node) => `style-${node.id}`,
      );
      const characterNodeIds = (projectGraph.characterNodes ?? []).map(
        (node) => `character-${node.id}`,
      );
      const storyNodeId = projectGraph.story
        ? `story-${projectGraph.story.id}`
        : null;
      const positionById = new Map(
        canvasNodes.map((node) => [node.id, node.position] as const),
      );

      styleNodeIds.forEach((sourceStyleId) => {
        const sourcePosition = positionById.get(sourceStyleId);
        if (!sourcePosition) {
          return;
        }

        if (storyNodeId) {
          const targetPosition = positionById.get(storyNodeId);
          if (targetPosition) {
            const sides = getNearestHandleSides({
              source: sourcePosition,
              target: targetPosition,
            });

            edges.push({
              id: `edge-${sourceStyleId}-to-${storyNodeId}`,
              source: sourceStyleId,
              target: storyNodeId,
              sourceHandle: getSourceHandleId(sides.source),
              targetHandle: getTargetHandleId(sides.target),
              type: 'smoothstep',
              animated: true,
              style: { strokeWidth: 2 },
              selectable: false,
              deletable: false,
            });
          }
        }

        characterNodeIds.forEach((targetCharacterId) => {
          const targetPosition = positionById.get(targetCharacterId);
          if (!targetPosition) {
            return;
          }

          const sides = getNearestHandleSides({
            source: sourcePosition,
            target: targetPosition,
          });

          edges.push({
            id: `edge-${sourceStyleId}-to-${targetCharacterId}`,
            source: sourceStyleId,
            target: targetCharacterId,
            sourceHandle: getSourceHandleId(sides.source),
            targetHandle: getTargetHandleId(sides.target),
            type: 'smoothstep',
            animated: true,
            style: { strokeWidth: 2 },
            selectable: false,
            deletable: false,
          });
        });
      });

      return edges;
    },
    [projectGraph],
  );

  useEffect(() => {
    const projectIdFromUrl = getProjectIdFromSearch(location.search);
    setActiveProjectId(projectIdFromUrl);
  }, [location.search]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const currentUrlProjectId = params.get('projectId')?.trim() || '';
    const targetProjectId = activeProjectId.trim();

    if (currentUrlProjectId === targetProjectId) {
      return;
    }

    if (targetProjectId) {
      params.set('projectId', targetProjectId);
    } else {
      params.delete('projectId');
    }

    const nextSearch = params.toString();
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : '',
      },
      { replace: true },
    );
  }, [activeProjectId, location.pathname, location.search, navigate]);

  useEffect(() => {
    const autosaveTimers = characterAutosaveTimersRef.current;
    const styleAutosaveTimers = styleAutosaveTimersRef.current;

    const client = createAgentSocket({
      projectId: initialProjectIdRef.current || undefined,
      onOpen: () => {
        setConnected(true);
        setSocketStatus('voice socket connected');
        setVoiceState('idle');
      },
      onClose: () => {
        setConnected(false);
        setSocketStatus('voice socket disconnected, retrying...');
        setVoiceState('idle');
      },
      onError: (message) => {
        setSocketStatus(message);
      },
      onCloseDetail: ({ code, reason }) => {
        if (reason) {
          setSocketStatus(`socket closed (${code}): ${reason}`);
          return;
        }

        setSocketStatus(`socket closed (${code}), retrying...`);
      },
      onMessage: (message) => {
        if (message.type === 'error') {
          const payload =
            typeof message.payload === 'string'
              ? message.payload
              : 'WebSocket server error';
          setSocketStatus(payload);
          return;
        }

        if (message.type === 'ws.ready') {
          setSocketStatus('voice socket ready');
          return;
        }

        if (message.type === 'agent.context.request') {
          const payload =
            message.payload && typeof message.payload === 'object'
              ? (message.payload as Record<string, unknown>)
              : null;

          const requestedProjectId =
            payload && typeof payload.projectId === 'string'
              ? payload.projectId
              : null;
          const requestedProjectName =
            payload && typeof payload.projectName === 'string'
              ? payload.projectName
              : null;

          if (requestedProjectId) {
            const pendingName = requestedProjectName?.trim();
            setActiveProjectId(requestedProjectId);
            setProjectName(pendingName || 'Active project');

            pendingContextSwitchRef.current = {
              projectId: requestedProjectId,
              projectName: pendingName || undefined,
              assistantAudioStarted: false,
              signalExtended: false,
              requestedAt: Date.now(),
              deadlineAt: Date.now() + CONTEXT_SWITCH_TIMEOUT_MS,
            };

            schedulePendingContextSwitchCheck();
          }

          return;
        }

        if (message.type === 'agent.context.updated') {
          const payload =
            message.payload && typeof message.payload === 'object'
              ? (message.payload as Record<string, unknown>)
              : null;
          const activeName =
            payload && typeof payload.projectName === 'string'
              ? payload.projectName.trim()
              : '';
          const activeProjectIdFromMessage =
            payload && typeof payload.projectId === 'string'
              ? payload.projectId.trim()
              : '';
          setActiveProjectId(activeProjectIdFromMessage);
          setProjectName(activeName || 'Active project');
          return;
        }

        if (message.type === 'agent.project.changed') {
          const payload =
            message.payload && typeof message.payload === 'object'
              ? (message.payload as Record<string, unknown>)
              : null;
          const changedProjectId =
            payload && typeof payload.projectId === 'string'
              ? payload.projectId.trim()
              : '';

          if (
            !changedProjectId ||
            changedProjectId === activeProjectIdRef.current.trim()
          ) {
            setProjectGraphRefreshToken((value) => value + 1);
          }

          return;
        }

        if (message.type === 'ws.audio.ingested') {
          const payload = message.payload as
            | { ingestedChunks?: number }
            | undefined;
          if (typeof payload?.ingestedChunks === 'number') {
            setIngestedChunks(payload.ingestedChunks);
          }
          return;
        }

        if (message.type === 'gemini.voiceActivity') {
          const payload = message.payload as
            | { state?: 'idle' | 'active'; source?: string }
            | undefined;
          if (payload?.state) {
            setVoiceState(payload.state);
            if (payload.state === 'active') {
              const didInterrupt = interruptPlayback();
              if (didInterrupt) {
                notifyInterrupted();
                flushPendingContextSwitch();
              }
            }
          }
          return;
        }

        if (message.type === 'gemini.server') {
          const payload = message.payload;
          const nextVoiceState = extractVoiceState(payload);
          if (nextVoiceState) {
            setVoiceState(nextVoiceState);
            if (nextVoiceState === 'active') {
              const didInterrupt = interruptPlayback();
              if (didInterrupt) {
                notifyInterrupted();
                flushPendingContextSwitch();
              }
            }
          }

          const input = extractInputTranscription(payload);
          if (input) {
            setCaptionLines((value) => updateCaptionLines(value, 'You', input));
          }

          const transcription = extractOutputTranscription(payload);
          if (transcription) {
            setCaptionLines((value) =>
              updateCaptionLines(value, 'Leo', transcription),
            );
          }

          const chunks = extractAudioChunks(payload);
          const pendingContextSwitch = pendingContextSwitchRef.current;
          if (
            pendingContextSwitch &&
            !pendingContextSwitch.assistantAudioStarted &&
            !pendingContextSwitch.signalExtended &&
            (Boolean(transcription) || chunks.length > 0)
          ) {
            const hardDeadline =
              pendingContextSwitch.requestedAt + CONTEXT_SWITCH_HARD_TIMEOUT_MS;
            const candidateDeadline =
              Date.now() + CONTEXT_SWITCH_SIGNAL_EXTENSION_MS;
            const nextDeadline = Math.min(hardDeadline, candidateDeadline);

            if (nextDeadline > pendingContextSwitch.deadlineAt) {
              pendingContextSwitch.deadlineAt = nextDeadline;
              pendingContextSwitch.signalExtended = true;
            }
          }

          if (!chunks.length) {
            return;
          }

          if (pendingContextSwitchRef.current) {
            pendingContextSwitchRef.current.assistantAudioStarted = true;
          }

          if (!playbackContextRef.current) {
            playbackContextRef.current = new window.AudioContext();
            playbackCursorRef.current = playbackContextRef.current.currentTime;
          }

          const playbackContext = playbackContextRef.current;
          if (!playbackContext) {
            return;
          }

          if (playbackContext.state === 'suspended') {
            void playbackContext.resume();
          }

          for (const chunk of chunks) {
            if (!chunk.mimeType.toLowerCase().startsWith('audio/pcm')) {
              continue;
            }

            const sampleRate = parsePcmRate(chunk.mimeType);
            const pcm16 = base64ToPcm16(chunk.data);
            const audioBuffer = pcm16ToAudioBuffer(
              playbackContext,
              pcm16,
              sampleRate,
            );

            const source = playbackContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(playbackContext.destination);
            playbackSourcesRef.current.add(source);
            source.onended = () => {
              source.disconnect();
              playbackSourcesRef.current.delete(source);

              if (playbackSourcesRef.current.size === 0) {
                schedulePendingContextSwitchCheck();
              }
            };

            const startAt = Math.max(
              playbackContext.currentTime,
              playbackCursorRef.current,
            );
            source.start(startAt);
            playbackCursorRef.current = startAt + audioBuffer.duration;
          }
        }
      },
    });

    socketClientRef.current = client;

    return () => {
      client.close();
      socketClientRef.current = null;
      pendingContextSwitchRef.current = null;
      clearPendingContextSwitchTimer();
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;

      processorNodeRef.current?.disconnect();
      sourceNodeRef.current?.disconnect();
      sinkGainNodeRef.current?.disconnect();
      loopbackGainNodeRef.current?.disconnect();
      void audioContextRef.current?.close();

      processorNodeRef.current = null;
      sourceNodeRef.current = null;
      sinkGainNodeRef.current = null;
      loopbackGainNodeRef.current = null;
      audioContextRef.current = null;

      void playbackContextRef.current?.close();
      playbackContextRef.current = null;
      playbackCursorRef.current = 0;

      if (interruptedBadgeTimerRef.current) {
        window.clearTimeout(interruptedBadgeTimerRef.current);
        interruptedBadgeTimerRef.current = null;
      }

      if (captionClearTimerRef.current) {
        window.clearTimeout(captionClearTimerRef.current);
        captionClearTimerRef.current = null;
      }

      for (const timerId of autosaveTimers.values()) {
        window.clearTimeout(timerId);
      }
      autosaveTimers.clear();

      for (const timerId of styleAutosaveTimers.values()) {
        window.clearTimeout(timerId);
      }
      styleAutosaveTimers.clear();
    };
  }, [
    clearPendingContextSwitchTimer,
    flushPendingContextSwitch,
    interruptPlayback,
    notifyInterrupted,
    schedulePendingContextSwitchCheck,
  ]);

  const stopMicCapture = useCallback(() => {
    interruptPlayback();

    socketClientRef.current?.send({
      type: 'gemini.realtimeEnd',
      payload: { reason: 'mic_stopped' },
    });

    processorNodeRef.current?.disconnect();
    sourceNodeRef.current?.disconnect();
    sinkGainNodeRef.current?.disconnect();
    loopbackGainNodeRef.current?.disconnect();
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());

    void audioContextRef.current?.close();

    processorNodeRef.current = null;
    sourceNodeRef.current = null;
    sinkGainNodeRef.current = null;
    loopbackGainNodeRef.current = null;
    audioContextRef.current = null;
    mediaStreamRef.current = null;
    setMicActive(false);
  }, [interruptPlayback]);

  useEffect(() => {
    micActiveRef.current = micActive;
  }, [micActive]);

  const bytesToBase64 = (bytes: Uint8Array) => {
    let binary = '';
    const chunkSize = 0x8000;

    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const chunk = bytes.subarray(
        offset,
        Math.min(offset + chunkSize, bytes.length),
      );
      binary += String.fromCharCode(...chunk);
    }

    return btoa(binary);
  };

  const downsampleTo16k = (input: Float32Array, inputSampleRate: number) => {
    const targetSampleRate = 16000;
    if (inputSampleRate === targetSampleRate) {
      return input;
    }

    if (inputSampleRate < targetSampleRate) {
      return input;
    }

    const sampleRateRatio = inputSampleRate / targetSampleRate;
    const newLength = Math.round(input.length / sampleRateRatio);
    const output = new Float32Array(newLength);

    let offsetResult = 0;
    let offsetBuffer = 0;

    while (offsetResult < output.length) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
      let accumulator = 0;
      let count = 0;

      for (
        let index = offsetBuffer;
        index < nextOffsetBuffer && index < input.length;
        index += 1
      ) {
        accumulator += input[index];
        count += 1;
      }

      output[offsetResult] = count > 0 ? accumulator / count : 0;
      offsetResult += 1;
      offsetBuffer = nextOffsetBuffer;
    }

    return output;
  };

  const convertToPcm16 = (input: Float32Array) => {
    const pcm16 = new Int16Array(input.length);

    for (let index = 0; index < input.length; index += 1) {
      const clamped = Math.max(-1, Math.min(1, input[index]));
      pcm16[index] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    }

    return new Uint8Array(pcm16.buffer);
  };

  const startMicCapture = useCallback(
    async (options?: { requirePttHeld?: boolean }) => {
      if (micActiveRef.current || micStartingRef.current) {
        return;
      }

      micStartingRef.current = true;
      setMicError('');
      setSentChunks(0);
      setIngestedChunks(0);

      try {
        if (!connected) {
          throw new Error('Voice socket is not connected yet.');
        }

        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error(
            'Microphone capture is not supported in this browser.',
          );
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            sampleRate: 48000,
            sampleSize: 16,
            noiseSuppression: true,
            echoCancellation: true,
            autoGainControl: true,
          },
        });

        // Avoid getting stuck if key-up happens while permissions are pending.
        if (options?.requirePttHeld && !pttHeldRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        mediaStreamRef.current = stream;

        const audioContext = new window.AudioContext();
        await audioContext.resume();

        const source = audioContext.createMediaStreamSource(stream);
        const processor = audioContext.createScriptProcessor(4096, 1, 1);
        const sinkGain = audioContext.createGain();
        const loopbackGain = audioContext.createGain();
        sinkGain.gain.value = 0;
        loopbackGain.gain.value = loopbackEnabled ? 1 : 0;

        source.connect(processor);
        processor.connect(sinkGain);
        sinkGain.connect(audioContext.destination);
        source.connect(loopbackGain);
        loopbackGain.connect(audioContext.destination);

        audioContextRef.current = audioContext;
        sourceNodeRef.current = source;
        processorNodeRef.current = processor;
        sinkGainNodeRef.current = sinkGain;
        loopbackGainNodeRef.current = loopbackGain;

        processor.onaudioprocess = (event) => {
          const channelData = event.inputBuffer.getChannelData(0);
          if (!channelData || channelData.length === 0) {
            return;
          }

          const downsampled = downsampleTo16k(
            channelData,
            audioContext.sampleRate,
          );
          const pcmBytes = convertToPcm16(downsampled);
          const data = bytesToBase64(pcmBytes);

          socketClientRef.current?.send({
            type: 'gemini.realtimeInput',
            payload: {
              media: {
                mimeType: 'audio/pcm;rate=16000',
                data,
              },
            },
          });
          setSentChunks((value) => value + 1);
        };
        setMicActive(true);
      } catch (error) {
        stopMicCapture();
        setMicError(
          error instanceof Error
            ? error.message
            : 'Failed to start microphone capture.',
        );
      } finally {
        micStartingRef.current = false;
      }
    },
    [connected, loopbackEnabled, stopMicCapture],
  );

  useEffect(() => {
    const loopbackGain = loopbackGainNodeRef.current;
    if (!loopbackGain) {
      return;
    }

    loopbackGain.gain.value = loopbackEnabled ? 1 : 0;
  }, [loopbackEnabled]);

  const toggleMic = async () => {
    if (micActive) {
      stopMicCapture();
      return;
    }

    await startMicCapture();
  };

  const sendDebugTextInput = useCallback(() => {
    const text = debugTextInput.trim();
    if (!text) {
      return;
    }

    if (!connected) {
      setMicError('Voice socket is not connected yet.');
      return;
    }

    socketClientRef.current?.send({
      type: 'gemini.clientContent',
      payload: {
        turns: [
          {
            role: 'user',
            parts: [{ text }],
          },
        ],
        turnComplete: true,
      },
    });

    setCaptionLines((value) => updateCaptionLines(value, 'You', text));

    setDebugTextInput('');
    setMicError('');
  }, [connected, debugTextInput]);

  useEffect(() => {
    const projectId = activeProjectId.trim();
    if (!projectId) {
      setProjectName('No active project');
      setProjectGraph(null);
      setNodes([]);
      setCharacterDrafts({});
      for (const timerId of characterAutosaveTimersRef.current.values()) {
        window.clearTimeout(timerId);
      }
      characterAutosaveTimersRef.current.clear();
      for (const timerId of styleAutosaveTimersRef.current.values()) {
        window.clearTimeout(timerId);
      }
      styleAutosaveTimersRef.current.clear();
      for (const timerId of nodePositionSaveTimersRef.current.values()) {
        window.clearTimeout(timerId);
      }
      nodePositionSaveTimersRef.current.clear();
      lastSavedNodePositionsRef.current = {};
      setStoryMarkdownInput('');
      setStoryGoogleDocUrl('');
      setStoryImportStatus('');
      setStoryImportError('');
      return;
    }

    let cancelled = false;

    void fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
      credentials: 'include',
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('Failed to load active project story state.');
        }

        return (await response.json()) as ProjectDetailsResponse;
      })
      .then((payload) => {
        if (cancelled) {
          return;
        }

        const project = payload.project ?? null;
        setProjectGraph(project);
        setProjectName(project?.name?.trim() || 'Active project');

        const existingStory = project?.story;
        setStoryMarkdownInput(existingStory?.markdown ?? '');
        setStoryGoogleDocUrl(existingStory?.sourceDocUrl ?? '');
        setStoryImportStatus('');
        setStoryImportError('');
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setProjectGraph(null);
        setNodes([]);
        setProjectName('No active project');
        setStoryImportError(
          error instanceof Error
            ? error.message
            : 'Failed to load active project story state.',
        );
      });

    return () => {
      cancelled = true;
    };
  }, [activeProjectId, projectGraphRefreshToken, setNodes]);

  useEffect(() => {
    if (!projectGraph?.characterNodes?.length) {
      setCharacterDrafts({});
      return;
    }

    setCharacterDrafts((current) => {
      const next: Record<string, CharacterDraftState> = {};

      for (const character of projectGraph.characterNodes ?? []) {
        const existing = current[character.id];
        if (
          existing &&
          (existing.saveState === 'saving' || existing.saveState === 'error')
        ) {
          next[character.id] = existing;
          continue;
        }

        const derived = buildCharacterDraftFromRecord(character);
        next[character.id] = {
          name: derived.name,
          description: derived.description,
          traitsText: derived.traitsText,
          saveState: existing?.saveState === 'saved' ? 'saved' : 'idle',
          saveMessage: existing?.saveState === 'saved' ? 'Saved' : 'Autosave',
        };
      }

      return next;
    });
  }, [projectGraph]);

  useEffect(() => {
    if (!projectGraph?.styleNodes?.length) {
      setStyleDrafts({});
      return;
    }

    setStyleDrafts((current) => {
      const next: Record<string, StyleDraftState> = {};

      for (const styleNode of projectGraph.styleNodes ?? []) {
        const existing = current[styleNode.id];
        if (
          existing &&
          (existing.saveState === 'saving' || existing.saveState === 'error')
        ) {
          next[styleNode.id] = existing;
          continue;
        }

        const derived = buildStyleDraftFromRecord(styleNode);
        next[styleNode.id] = {
          ...derived,
          saveState: existing?.saveState === 'saved' ? 'saved' : 'idle',
          saveMessage: existing?.saveState === 'saved' ? 'Saved' : 'Autosave',
        };
      }

      return next;
    });
  }, [projectGraph]);

  const importStoryForActiveProject = useCallback(
    async (mode: StoryImportMode) => {
      const projectId = activeProjectId.trim();
      if (!projectId) {
        setStoryImportError('Select an active project before importing story.');
        return;
      }

      const markdown = storyMarkdownInput.trim();
      const sourceUrl = storyGoogleDocUrl.trim();

      if (mode === 'markdown' && !markdown) {
        setStoryImportError('Paste markdown content before saving.');
        return;
      }

      if (mode === 'google_docs' && !sourceUrl) {
        setStoryImportError('Paste a Google Docs URL before fetching story.');
        return;
      }

      setStoryImportBusy(true);
      setStoryImportStatus('');
      setStoryImportError('');

      try {
        const response = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/story/import`,
          {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(
              mode === 'google_docs'
                ? { sourceUrl }
                : {
                    markdown,
                  },
            ),
          },
        );

        const payload = (await response.json()) as StoryImportResponse;
        if (!response.ok) {
          throw new Error(payload.error || 'Story import failed.');
        }

        const story = payload.story;
        if (story) {
          setStoryMarkdownInput(story.markdown ?? markdown);
          setStoryGoogleDocUrl(story.sourceDocUrl ?? sourceUrl);
        }

        setStoryImportStatus(
          mode === 'google_docs'
            ? 'Story fetched from Google Docs and saved.'
            : 'Story markdown saved.',
        );
      } catch (error) {
        setStoryImportError(
          error instanceof Error ? error.message : 'Story import failed.',
        );
      } finally {
        setStoryImportBusy(false);
      }
    },
    [activeProjectId, storyGoogleDocUrl, storyMarkdownInput],
  );

  const saveCharacterDraft = useCallback(
    async (characterId: string, draft: CharacterDraftState) => {
      const projectId = activeProjectId.trim();
      if (!projectId) {
        return;
      }

      setCharacterDrafts((current) => ({
        ...current,
        [characterId]: {
          ...draft,
          saveState: 'saving',
          saveMessage: 'Saving...',
        },
      }));

      try {
        const response = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/character-nodes/${encodeURIComponent(characterId)}`,
          {
            method: 'PATCH',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              name: draft.name,
              description: draft.description,
              traitsText: draft.traitsText,
            }),
          },
        );

        const payload = (await response.json()) as
          | CharacterNodeUpdateResponse
          | undefined;

        if (!response.ok || !payload?.ok || !payload.node) {
          throw new Error(
            payload?.error || 'Failed to save character changes.',
          );
        }

        setCharacterDrafts((current) => ({
          ...current,
          [characterId]: {
            ...draft,
            saveState: 'saved',
            saveMessage: 'Saved',
          },
        }));

        setProjectGraph((current) => {
          if (!current) {
            return current;
          }

          const nextCharacterNodes = (current.characterNodes ?? []).map(
            (node) => (node.id === characterId ? payload.node! : node),
          );

          return {
            ...current,
            characterNodes: nextCharacterNodes,
          };
        });
      } catch (error) {
        setCharacterDrafts((current) => ({
          ...current,
          [characterId]: {
            ...draft,
            saveState: 'error',
            saveMessage:
              error instanceof Error
                ? error.message
                : 'Failed to save character changes.',
          },
        }));
      }
    },
    [activeProjectId],
  );

  const queueCharacterAutosave = useCallback(
    (characterId: string) => {
      const existingTimer = characterAutosaveTimersRef.current.get(characterId);
      if (existingTimer) {
        window.clearTimeout(existingTimer);
      }

      const nextTimer = window.setTimeout(() => {
        const latestDraft = characterDraftsRef.current[characterId];
        if (!latestDraft) {
          return;
        }

        void saveCharacterDraft(characterId, latestDraft);
        characterAutosaveTimersRef.current.delete(characterId);
      }, 700);

      characterAutosaveTimersRef.current.set(characterId, nextTimer);
    },
    [saveCharacterDraft],
  );

  const updateCharacterDraftField = useCallback(
    (
      characterId: string,
      field: 'name' | 'description' | 'traitsText',
      value: string,
    ) => {
      setCharacterDrafts((current) => {
        const existing = current[characterId];
        if (!existing) {
          return current;
        }

        return {
          ...current,
          [characterId]: {
            ...existing,
            [field]: value,
            saveState: 'idle',
            saveMessage: 'Autosave pending...',
          },
        };
      });

      queueCharacterAutosave(characterId);
    },
    [queueCharacterAutosave],
  );

  const saveStyleDraft = useCallback(
    async (styleId: string, draft: StyleDraftState) => {
      const projectId = activeProjectId.trim();
      if (!projectId) {
        return;
      }

      setStyleDrafts((current) => ({
        ...current,
        [styleId]: {
          ...draft,
          saveState: 'saving',
          saveMessage: 'Saving...',
        },
      }));

      try {
        const response = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/style-nodes/${encodeURIComponent(styleId)}`,
          {
            method: 'PATCH',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              name: draft.name,
              writingStyle: draft.writingStyle,
              characterStyle: draft.characterStyle,
              artStyle: draft.artStyle,
              storytellingPacing: draft.storytellingPacing,
              extrasText: draft.extrasText,
            }),
          },
        );

        const payload = (await response.json()) as
          | StyleNodeUpdateResponse
          | undefined;

        if (!response.ok || !payload?.ok || !payload.node) {
          throw new Error(payload?.error || 'Failed to save style changes.');
        }

        setStyleDrafts((current) => ({
          ...current,
          [styleId]: {
            ...draft,
            saveState: 'saved',
            saveMessage: 'Saved',
          },
        }));

        setProjectGraph((current) => {
          if (!current) {
            return current;
          }

          const nextStyleNodes = (current.styleNodes ?? []).map((node) =>
            node.id === styleId ? payload.node! : node,
          );

          return {
            ...current,
            styleNodes: nextStyleNodes,
          };
        });
      } catch (error) {
        setStyleDrafts((current) => ({
          ...current,
          [styleId]: {
            ...draft,
            saveState: 'error',
            saveMessage:
              error instanceof Error
                ? error.message
                : 'Failed to save style changes.',
          },
        }));
      }
    },
    [activeProjectId],
  );

  const queueStyleAutosave = useCallback(
    (styleId: string) => {
      const existingTimer = styleAutosaveTimersRef.current.get(styleId);
      if (existingTimer) {
        window.clearTimeout(existingTimer);
      }

      const nextTimer = window.setTimeout(() => {
        const latestDraft = styleDraftsRef.current[styleId];
        if (!latestDraft) {
          return;
        }

        void saveStyleDraft(styleId, latestDraft);
        styleAutosaveTimersRef.current.delete(styleId);
      }, 700);

      styleAutosaveTimersRef.current.set(styleId, nextTimer);
    },
    [saveStyleDraft],
  );

  const updateStyleDraftField = useCallback(
    (
      styleId: string,
      field:
        | 'name'
        | 'writingStyle'
        | 'characterStyle'
        | 'artStyle'
        | 'storytellingPacing'
        | 'extrasText',
      value: string,
    ) => {
      setStyleDrafts((current) => {
        const existing = current[styleId];
        if (!existing) {
          return current;
        }

        return {
          ...current,
          [styleId]: {
            ...existing,
            [field]: value,
            saveState: 'idle',
            saveMessage: 'Autosave pending...',
          },
        };
      });

      queueStyleAutosave(styleId);
    },
    [queueStyleAutosave],
  );

  const deleteNodeFromDatabase = useCallback(
    async (nodeId: string) => {
      const projectId = activeProjectId.trim();
      if (!projectId) {
        return;
      }

      let endpoint = '';
      if (nodeId.startsWith('story-')) {
        endpoint = `/api/projects/${encodeURIComponent(projectId)}/story`;
      } else if (nodeId.startsWith('character-')) {
        endpoint = `/api/projects/${encodeURIComponent(projectId)}/character-nodes/${encodeURIComponent(
          nodeId.replace('character-', ''),
        )}`;
      } else if (nodeId.startsWith('style-')) {
        endpoint = `/api/projects/${encodeURIComponent(projectId)}/style-nodes/${encodeURIComponent(
          nodeId.replace('style-', ''),
        )}`;
      } else if (nodeId.startsWith('storyboard-')) {
        endpoint = `/api/projects/${encodeURIComponent(projectId)}/storyboard-nodes/${encodeURIComponent(
          nodeId.replace('storyboard-', ''),
        )}`;
      } else {
        return;
      }

      try {
        const response = await fetch(endpoint, {
          method: 'DELETE',
          credentials: 'include',
        });

        if (!response.ok) {
          throw new Error('Failed to delete node from project database.');
        }

        setProjectGraphRefreshToken((value) => value + 1);
      } catch (error) {
        setSocketStatus(
          error instanceof Error
            ? error.message
            : 'Failed to delete node from project database.',
        );
        setProjectGraphRefreshToken((value) => value + 1);
      }
    },
    [activeProjectId],
  );

  const saveNodePosition = useCallback(
    async (nodeId: string, position: { x: number; y: number }) => {
      const projectId = activeProjectId.trim();
      if (!projectId) {
        return;
      }

      let endpoint = '';
      if (nodeId.startsWith('story-')) {
        endpoint = `/api/projects/${encodeURIComponent(projectId)}/story/position`;
      } else if (nodeId.startsWith('character-')) {
        endpoint = `/api/projects/${encodeURIComponent(projectId)}/character-nodes/${encodeURIComponent(
          nodeId.replace('character-', ''),
        )}/position`;
      } else if (nodeId.startsWith('style-')) {
        endpoint = `/api/projects/${encodeURIComponent(projectId)}/style-nodes/${encodeURIComponent(
          nodeId.replace('style-', ''),
        )}/position`;
      } else if (nodeId.startsWith('storyboard-')) {
        endpoint = `/api/projects/${encodeURIComponent(projectId)}/storyboard-nodes/${encodeURIComponent(
          nodeId.replace('storyboard-', ''),
        )}/position`;
      } else {
        return;
      }

      try {
        const response = await fetch(endpoint, {
          method: 'PATCH',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            positionX: position.x,
            positionY: position.y,
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to save node position.');
        }

        lastSavedNodePositionsRef.current[nodeId] = position;
      } catch (error) {
        setSocketStatus(
          error instanceof Error
            ? error.message
            : 'Failed to save node position.',
        );
      }
    },
    [activeProjectId],
  );

  const queueNodePositionSave = useCallback(
    (nodeId: string, position: { x: number; y: number }) => {
      const existingTimer = nodePositionSaveTimersRef.current.get(nodeId);
      if (existingTimer) {
        window.clearTimeout(existingTimer);
      }

      const timerId = window.setTimeout(() => {
        void saveNodePosition(nodeId, position);
        nodePositionSaveTimersRef.current.delete(nodeId);
      }, 180);

      nodePositionSaveTimersRef.current.set(nodeId, timerId);
    },
    [saveNodePosition],
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange<Node<CanvasNodeData>>[]) => {
      onNodesChange(changes);

      const positionChanges = changes.filter(
        (
          change,
        ): change is NodePositionChange & {
          id: string;
          position: { x: number; y: number };
        } =>
          change.type === 'position' &&
          'id' in change &&
          !!change.position &&
          typeof change.position.x === 'number' &&
          typeof change.position.y === 'number',
      );

      positionChanges.forEach((change) => {
        if (change.dragging) {
          return;
        }

        const nextPosition = {
          x: change.position.x,
          y: change.position.y,
        };

        const previousSaved = lastSavedNodePositionsRef.current[change.id];
        if (
          previousSaved &&
          Math.abs(previousSaved.x - nextPosition.x) < 0.5 &&
          Math.abs(previousSaved.y - nextPosition.y) < 0.5
        ) {
          return;
        }

        queueNodePositionSave(change.id, nextPosition);
      });

      const removedNodeIds = changes
        .filter(
          (
            change,
          ): change is NodeChange<Node<CanvasNodeData>> & { id: string } =>
            change.type === 'remove' && 'id' in change,
        )
        .map((change) => change.id);

      removedNodeIds.forEach((id) => {
        if (id.startsWith('character-')) {
          const characterId = id.replace('character-', '');
          const autosaveTimer =
            characterAutosaveTimersRef.current.get(characterId);
          if (autosaveTimer) {
            window.clearTimeout(autosaveTimer);
            characterAutosaveTimersRef.current.delete(characterId);
          }
        }

        if (id.startsWith('style-')) {
          const styleId = id.replace('style-', '');
          const autosaveTimer = styleAutosaveTimersRef.current.get(styleId);
          if (autosaveTimer) {
            window.clearTimeout(autosaveTimer);
            styleAutosaveTimersRef.current.delete(styleId);
          }
        }

        const timer = nodePositionSaveTimersRef.current.get(id);
        if (timer) {
          window.clearTimeout(timer);
          nodePositionSaveTimersRef.current.delete(id);
        }
        delete lastSavedNodePositionsRef.current[id];
        void deleteNodeFromDatabase(id);
      });
    },
    [deleteNodeFromDatabase, onNodesChange, queueNodePositionSave],
  );

  useEffect(() => {
    if (!activeProjectId.trim() || !projectGraph) {
      setNodes([]);
      setEdges([]);
      return;
    }

    const nextNodes: Node<CanvasNodeData>[] = [];
    const occupiedCells = new Set<string>();
    const characterNodes = projectGraph.characterNodes ?? [];
    const styleNodes = projectGraph.styleNodes ?? [];
    const hasStyleIncomingConnections = styleNodes.length > 0;
    const hasStyleOutgoingConnections =
      Boolean(projectGraph.story) || characterNodes.length > 0;

    const resolveNodePosition = (
      positionX: number | null | undefined,
      positionY: number | null | undefined,
      legacyFallback: { x: number; y: number },
    ) => {
      if (Number.isFinite(positionX) && Number.isFinite(positionY)) {
        const persisted = {
          x: positionX as number,
          y: positionY as number,
        };

        if (reserveGridCell(occupiedCells, persisted)) {
          return persisted;
        }
      }

      if (reserveGridCell(occupiedCells, legacyFallback)) {
        return legacyFallback;
      }

      return allocateNextGridPosition(occupiedCells);
    };

    if (projectGraph.story) {
      const nodeData: StoryImportNodeData = {
        activeProjectId,
        hasIncomingConnection: hasStyleIncomingConnections,
        mode: storyImportMode,
        markdownInput: storyMarkdownInput,
        googleDocUrl: storyGoogleDocUrl,
        busy: storyImportBusy,
        status: storyImportStatus,
        error: storyImportError,
        onModeChange: setStoryImportMode,
        onMarkdownChange: setStoryMarkdownInput,
        onGoogleDocUrlChange: setStoryGoogleDocUrl,
        onSave: () => {
          void importStoryForActiveProject('markdown');
        },
        onFetchGoogleDocs: () => {
          void importStoryForActiveProject('google_docs');
        },
      };

      nextNodes.push({
        id: `story-${projectGraph.story.id}`,
        type: 'storyImport',
        position: resolveNodePosition(
          projectGraph.story.positionX,
          projectGraph.story.positionY,
          { x: 80, y: 120 },
        ),
        draggable: true,
        data: nodeData,
      });
    }

    characterNodes.forEach((character, index) => {
      const derived = buildCharacterDraftFromRecord(character);
      const draft = characterDrafts[character.id] ?? {
        name: derived.name,
        description: derived.description,
        traitsText: derived.traitsText,
        saveState: 'idle',
        saveMessage: 'Autosave',
      };

      nextNodes.push({
        id: `character-${character.id}`,
        type: 'characterCard',
        position: resolveNodePosition(
          character.positionX,
          character.positionY,
          {
            x: 640,
            y: 120 + index * 440,
          },
        ),
        data: {
          characterId: character.id,
          hasIncomingConnection: hasStyleIncomingConnections,
          name: draft.name,
          description: draft.description,
          traitsText: draft.traitsText,
          saveState: draft.saveState,
          saveMessage: draft.saveMessage,
          onNameChange: (value: string) =>
            updateCharacterDraftField(character.id, 'name', value),
          onDescriptionChange: (value: string) =>
            updateCharacterDraftField(character.id, 'description', value),
          onTraitsChange: (value: string) =>
            updateCharacterDraftField(character.id, 'traitsText', value),
        },
      });
    });

    styleNodes.forEach((styleNode, index) => {
      const draft =
        styleDrafts[styleNode.id] ?? buildStyleDraftFromRecord(styleNode);

      nextNodes.push({
        id: `style-${styleNode.id}`,
        type: 'styleCard',
        position: resolveNodePosition(
          styleNode.positionX,
          styleNode.positionY,
          {
            x: 980,
            y: 120 + index * 190,
          },
        ),
        data: {
          styleId: styleNode.id,
          hasOutgoingConnection: hasStyleOutgoingConnections,
          name: draft.name,
          writingStyle: draft.writingStyle,
          characterStyle: draft.characterStyle,
          artStyle: draft.artStyle,
          storytellingPacing: draft.storytellingPacing,
          extrasText: draft.extrasText,
          saveState: draft.saveState,
          saveMessage: draft.saveMessage,
          onNameChange: (value: string) =>
            updateStyleDraftField(styleNode.id, 'name', value),
          onWritingStyleChange: (value: string) =>
            updateStyleDraftField(styleNode.id, 'writingStyle', value),
          onCharacterStyleChange: (value: string) =>
            updateStyleDraftField(styleNode.id, 'characterStyle', value),
          onArtStyleChange: (value: string) =>
            updateStyleDraftField(styleNode.id, 'artStyle', value),
          onStorytellingPacingChange: (value: string) =>
            updateStyleDraftField(styleNode.id, 'storytellingPacing', value),
          onExtrasTextChange: (value: string) =>
            updateStyleDraftField(styleNode.id, 'extrasText', value),
        },
      });
    });

    const currentPositionById = new Map(
      nodesRef.current.map((node) => [node.id, node.position] as const),
    );

    const finalNodes = nextNodes.map((node) => {
      const existingPosition = currentPositionById.get(node.id);
      if (!existingPosition) {
        return node;
      }

      return {
        ...node,
        position: existingPosition,
      };
    });

    const storyboardNodes = projectGraph.storyboardNodes ?? [];
    storyboardNodes.forEach((storyboard, index) => {
      nextNodes.push({
        id: `storyboard-${storyboard.id}`,
        position: resolveNodePosition(
          storyboard.positionX,
          storyboard.positionY,
          {
            x: 1320,
            y: 120 + index * 190,
          },
        ),
        data: {
          label: storyboard.title,
          description: 'Storyboard node synced from database.',
        },
      });
    });

    setNodes(finalNodes);

    setEdges(buildAutoStyleEdges(finalNodes));
  }, [
    activeProjectId,
    buildAutoStyleEdges,
    setEdges,
    importStoryForActiveProject,
    projectGraph,
    setNodes,
    storyGoogleDocUrl,
    storyImportBusy,
    storyImportError,
    storyImportMode,
    storyImportStatus,
    storyMarkdownInput,
    characterDrafts,
    styleDrafts,
    updateCharacterDraftField,
    updateStyleDraftField,
  ]);

  useEffect(() => {
    if (!activeProjectId.trim() || !projectGraph) {
      return;
    }

    setEdges(buildAutoStyleEdges(nodes));
  }, [activeProjectId, buildAutoStyleEdges, nodes, projectGraph, setEdges]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) {
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      if (micActiveRef.current || pttHeldRef.current) {
        return;
      }

      pttHeldRef.current = true;
      pttMicActivatedRef.current = true;
      event.preventDefault();
      void startMicCapture({ requirePttHeld: true });
    };

    const releasePtt = () => {
      if (!pttHeldRef.current) {
        return;
      }

      pttHeldRef.current = false;

      if (!pttMicActivatedRef.current) {
        return;
      }

      pttMicActivatedRef.current = false;
      if (micActiveRef.current) {
        stopMicCapture();
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') {
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      event.preventDefault();
      releasePtt();
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        releasePtt();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', releasePtt);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', releasePtt);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [startMicCapture, stopMicCapture]);

  useEffect(() => {
    if (!connected && micActive) {
      stopMicCapture();
      setMicError('Voice socket disconnected.');
    }
  }, [connected, micActive, stopMicCapture]);

  return (
    <div className='h-screen w-screen bg-background p-6 text-foreground'>
      <Card className='relative h-full w-full overflow-hidden rounded-4xl border-2 border-border'>
        <div className='absolute left-6 top-6 z-10 flex items-center gap-2'>
          <Badge variant='outline' className='bg-background px-4 py-2 text-sm'>
            {projectName}
          </Badge>
          <Button variant='outline' onClick={() => navigate('/debug')}>
            Debug Monitor
          </Button>
        </div>

        <div className='absolute right-6 top-6 z-10'>
          <Button variant='outline' size='icon' className='rounded-full'>
            <User className='h-5 w-5' />
          </Button>
          <p className='mt-1 text-right text-xs text-muted-foreground'>
            {userName || 'profile'}
          </p>

          {debugOverlayEnabled ? (
            <div className='mt-2 space-y-2'>
              <Badge variant='outline'>voice: {voiceState}</Badge>
              <label className='flex items-center justify-end gap-2 text-xs text-muted-foreground'>
                <span>loopback audio</span>
                <input
                  type='checkbox'
                  checked={loopbackEnabled}
                  onChange={(event) => setLoopbackEnabled(event.target.checked)}
                />
              </label>
            </div>
          ) : null}
        </div>

        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={FLOW_NODE_TYPES}
          onNodesChange={handleNodesChange}
          onEdgesChange={onEdgesChange}
          panOnScroll
          zoomOnScroll={false}
          zoomOnDoubleClick={false}
          zoomOnPinch
          defaultViewport={{ x: 0, y: 0, zoom: 0.72 }}
          minZoom={0.35}
          maxZoom={1.2}
          fitView
          fitViewOptions={{
            maxZoom: 0.72,
            padding: 0.2,
          }}
          className='bg-background'>
          <MiniMap pannable zoomable />
          <Controls />
          <Background gap={24} size={1} />
        </ReactFlow>

        <div className='absolute bottom-6 left-1/2 z-10 w-full max-w-xl -translate-x-1/2 px-6'>
          {ccEnabled && captionLines.length > 0 ? (
            <Card className='mb-3 border border-border bg-card/95 p-3'>
              <div className='space-y-1 text-xs'>
                {captionLines.map((line, index) => (
                  <p
                    key={`${line.speaker}-${index}-${line.text}`}
                    className='text-muted-foreground'>
                    <span className='font-medium text-foreground'>
                      {line.speaker}:
                    </span>{' '}
                    {line.text}
                  </p>
                ))}
              </div>
            </Card>
          ) : null}

          <div className='flex items-center justify-center gap-2'>
            <Button
              variant={ccEnabled ? 'default' : 'outline'}
              className='rounded-2xl'
              onClick={() => setCcEnabled((value) => !value)}>
              {ccEnabled ? (
                <Captions className='mr-2 h-4 w-4' />
              ) : (
                <CaptionsOff className='mr-2 h-4 w-4' />
              )}
              CC
            </Button>

            <Button
              variant={micActive ? 'default' : 'outline'}
              className='min-w-28 rounded-2xl'
              onClick={() => void toggleMic()}>
              {micActive ? (
                <Mic className='mr-2 h-4 w-4' />
              ) : (
                <MicOff className='mr-2 h-4 w-4' />
              )}
              Mic
            </Button>
          </div>
          {showInterruptedBadge ? (
            <div className='mt-1 flex justify-center'>
              <Badge variant='outline'>Leo interrupted</Badge>
            </div>
          ) : null}
          <p className='mt-1 text-center text-xs text-muted-foreground'>
            {socketStatus}
          </p>
          <p className='mt-1 text-center text-xs text-muted-foreground'>
            chunks sent: {sentChunks} • backend ingested: {ingestedChunks}
          </p>
          {debugOverlayEnabled ? (
            <div className='mt-3 flex items-center gap-2'>
              <input
                type='text'
                value={debugTextInput}
                onChange={(event) => setDebugTextInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    sendDebugTextInput();
                  }
                }}
                placeholder='Debug: type instead of talking'
                className='nowheel nopan h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm'
              />
              <Button
                variant='outline'
                className='h-9 rounded-md'
                disabled={!debugTextInput.trim() || !connected}
                onClick={sendDebugTextInput}>
                Send
              </Button>
            </div>
          ) : null}
          {!micActive ? (
            <p className='mt-1 text-center text-xs text-muted-foreground'>
              Hold Space to push-to-talk
            </p>
          ) : null}
          {micError ? (
            <p className='mt-1 text-center text-xs text-muted-foreground'>
              {micError}
            </p>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
