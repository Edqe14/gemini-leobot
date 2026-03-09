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

const MIC_PROCESSOR_BUFFER_SIZE = 1024;

type StoryRevisionRecord = {
  id: string;
  instruction: string;
  selectionText: string;
  selectionStart: number;
  selectionEnd: number;
  summary: string;
  previousMarkdown: string;
  nextMarkdown: string;
  source?: string | null;
  acceptedAt?: string;
};

type PendingStoryRewriteRecord = {
  instruction?: string | null;
  selectionText?: string | null;
  selectionStart?: number | null;
  selectionEnd?: number | null;
  replacementText?: string | null;
  markdown?: string | null;
  summary?: string | null;
  source?: string | null;
  toolCallId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type StoryRecord = {
  id: string;
  title: string;
  markdown: string;
  sourceDocUrl?: string | null;
  pendingRewriteInstruction?: string | null;
  pendingRewriteSelectionText?: string | null;
  pendingRewriteSelectionStart?: number | null;
  pendingRewriteSelectionEnd?: number | null;
  pendingRewriteReplacementText?: string | null;
  pendingRewriteMarkdown?: string | null;
  pendingRewriteSummary?: string | null;
  pendingRewriteSource?: string | null;
  pendingRewriteToolCallId?: string | null;
  pendingRewriteCreatedAt?: string | null;
  pendingRewriteUpdatedAt?: string | null;
  revisions?: StoryRevisionRecord[];
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
  characterDesigns?: CharacterDesignOptionRecord[];
  selectedCharacterDesignId?: string;
  characterDesignPrompt?: string;
  characterDesignNodePosition?: {
    x: number;
    y: number;
  };
  characterDesignGeneratedAt?: string;
};

type CharacterDesignOptionRecord = {
  id: string;
  imageUrl: string;
  imageDataUrl?: string;
  prompt?: string;
  createdAt?: string;
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
  shotsJson?: string | null;
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
  issues?: string[];
  stale?: boolean;
  proposal?: PendingStoryRewriteRecord;
  revisionCount?: number;
};

type CharacterSaveState = 'idle' | 'saving' | 'saved' | 'error';

type CharacterNodeUpdateResponse = {
  ok?: boolean;
  node?: CharacterNodeRecord;
  error?: string;
};

type CharacterDesignRegenerateResponse = {
  ok?: boolean;
  node?: CharacterNodeRecord;
  message?: string;
  error?: string;
};

type CharacterDesignSelectionResponse = {
  ok?: boolean;
  node?: CharacterNodeRecord;
  message?: string;
  error?: string;
};

type StyleSaveState = 'idle' | 'saving' | 'saved' | 'error';

type StoryboardFrameRecord = {
  frameNumber: number;
  description: string;
  cameraAngle: string;
  cameraMovement: string;
  characters: Array<{
    characterName: string;
    action: string;
    designCue: string;
  }>;
  durationSeconds: number;
  annotations: string[];
  imageStatus?: 'pending' | 'ready' | 'failed';
  imageUrl?: string;
};

type StoryboardSaveState = 'idle' | 'saving' | 'saved' | 'error' | 'generating';

type StoryboardDraftState = {
  title: string;
  frames: StoryboardFrameRecord[];
  saveState: StoryboardSaveState;
  saveMessage?: string;
  generationPhase?: 'descriptions' | 'images' | 'completed';
  isLocalDirty?: boolean;
};

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

type StoryboardNodeUpdateResponse = {
  ok?: boolean;
  node?: StoryboardNodeRecord;
  error?: string;
};

type StoryboardImageRegenerateResponse = {
  ok?: boolean;
  node?: StoryboardNodeRecord;
  frameNumber?: number;
  imageUrl?: string;
  attempts?: number;
  error?: string;
};

type CharacterDesignUiState = {
  mode: 'options' | 'picked';
  busy: boolean;
  error: string;
};

type ProjectListItem = {
  id: string;
  name: string;
  updatedAt: string;
  story: { title: string } | null;
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
  rewriteInstruction: string;
  selectionText: string;
  selectionStart: number;
  selectionEnd: number;
  pendingProposal: PendingStoryRewriteRecord | null;
  revisions: StoryRevisionRecord[];
  busy: boolean;
  rewriteBusy: boolean;
  status: string;
  error: string;
  rewriteStatus: string;
  rewriteError: string;
  onModeChange: (mode: StoryImportMode) => void;
  onMarkdownChange: (value: string) => void;
  onSelectionChange: (start: number, end: number) => void;
  onGoogleDocUrlChange: (value: string) => void;
  onRewriteInstructionChange: (value: string) => void;
  onFetchGoogleDocs: () => void;
  onCreateRewrite: () => void;
  onAcceptRewrite: () => void;
  onRejectRewrite: () => void;
};

type CharacterCardNodeData = {
  characterId: string;
  hasIncomingConnection: boolean;
  hasOutgoingConnection: boolean;
  name: string;
  description: string;
  traitsText: string;
  saveState: CharacterSaveState;
  saveMessage?: string;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onTraitsChange: (value: string) => void;
};

type CharacterDesignNodeData = {
  characterId: string;
  characterName: string;
  hasIncomingConnection: boolean;
  hasOutgoingConnection: boolean;
  options: CharacterDesignOptionRecord[];
  selectedOptionId: string;
  mode: 'options' | 'picked';
  busy: boolean;
  error: string;
  onRetry: () => void;
  onPick: (optionId: string) => void;
  onEdit: () => void;
  onCancel: () => void;
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

type StoryboardCardNodeData = {
  storyboardId: string;
  hasIncomingConnection: boolean;
  hasOutgoingConnection: boolean;
  title: string;
  frames: StoryboardFrameRecord[];
  saveState: StoryboardSaveState;
  saveMessage?: string;
  onTitleChange: (value: string) => void;
  onFrameDescriptionChange: (frameNumber: number, value: string) => void;
  onFrameDurationChange: (frameNumber: number, value: number) => void;
  onFrameRetryImage: (frameNumber: number) => void;
  onFrameAdd: () => void;
};

function getPendingStoryRewrite(story?: StoryRecord | null) {
  if (!story) {
    return null;
  }

  if (
    !story.pendingRewriteSelectionText ||
    !story.pendingRewriteReplacementText ||
    !story.pendingRewriteInstruction
  ) {
    return null;
  }

  return {
    instruction: story.pendingRewriteInstruction,
    selectionText: story.pendingRewriteSelectionText,
    selectionStart: story.pendingRewriteSelectionStart,
    selectionEnd: story.pendingRewriteSelectionEnd,
    replacementText: story.pendingRewriteReplacementText,
    markdown: story.pendingRewriteMarkdown,
    summary: story.pendingRewriteSummary,
    source: story.pendingRewriteSource,
    toolCallId: story.pendingRewriteToolCallId,
    createdAt: story.pendingRewriteCreatedAt,
    updatedAt: story.pendingRewriteUpdatedAt,
  } satisfies PendingStoryRewriteRecord;
}

type CanvasNodeData =
  | CreativeNodeData
  | StoryImportNodeData
  | CharacterCardNodeData
  | CharacterDesignNodeData
  | StyleCardNodeData
  | StoryboardCardNodeData;
type StoryImportCanvasNode = Node<StoryImportNodeData, 'storyImport'>;
type CharacterCardCanvasNode = Node<CharacterCardNodeData, 'characterCard'>;
type CharacterDesignCanvasNode = Node<
  CharacterDesignNodeData,
  'characterDesign'
>;
type StyleCardCanvasNode = Node<StyleCardNodeData, 'styleCard'>;
type StoryboardCardCanvasNode = Node<StoryboardCardNodeData, 'storyboard'>;

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

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function formatRewriteSourceLabel(source?: string | null) {
  const normalized = source?.trim().toLowerCase() || '';
  if (
    normalized === 'agent_tool' ||
    normalized === 'assistant' ||
    normalized === 'voice' ||
    normalized === 'voice_agent'
  ) {
    return 'Leo via voice';
  }

  if (normalized === 'story_node') {
    return 'Inline request';
  }

  return 'Pending suggestion';
}

function getHighlightedStorySegments(input: {
  text: string;
  start?: number | null;
  end?: number | null;
}) {
  const safeStart = clampNumber(input.start ?? 0, 0, input.text.length);
  const safeEnd = clampNumber(
    Math.max(input.end ?? safeStart, safeStart),
    safeStart,
    input.text.length,
  );
  const highlightText = input.text.slice(safeStart, safeEnd);

  return {
    before: input.text.slice(0, safeStart),
    highlight: highlightText,
    after: input.text.slice(safeEnd),
  };
}

function readEditablePlainText(element: HTMLElement) {
  const normalized = element.innerText.replace(/\u00a0/g, ' ');
  // contentEditable can append a trailing newline while editing.
  return normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;
}

function getSelectionOffsetsWithin(element: HTMLElement) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  if (
    !element.contains(range.startContainer) ||
    !element.contains(range.endContainer)
  ) {
    return null;
  }

  const textNodes: globalThis.Text[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let current: globalThis.Node | null = walker.nextNode();
  while (current) {
    textNodes.push(current as globalThis.Text);
    current = walker.nextNode();
  }

  let offset = 0;
  let start = 0;
  let end = 0;

  for (const textNode of textNodes) {
    const textLength = textNode.textContent?.length ?? 0;

    if (textNode === range.startContainer) {
      start = offset + range.startOffset;
    }

    if (textNode === range.endContainer) {
      end = offset + range.endOffset;
      break;
    }

    offset += textLength;
  }

  return {
    start: Math.max(0, start),
    end: Math.max(0, end),
  };
}

function StoryImportNodeComponent({ data }: NodeProps<StoryImportCanvasNode>) {
  const nodeData = data;
  const editorRef = useRef<HTMLDivElement | null>(null);
  const pendingSelection = getHighlightedStorySegments({
    text: nodeData.markdownInput,
    start: nodeData.pendingProposal?.selectionStart,
    end: nodeData.pendingProposal?.selectionEnd,
  });
  const selectionPreview = nodeData.selectionText.trim();
  const sourceLabel = formatRewriteSourceLabel(
    nodeData.pendingProposal?.source,
  );
  const wordCount = nodeData.markdownInput
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  const charCount = selectionPreview.length;

  return (
    <div className='relative w-200 overflow-visible'>
      {nodeData.hasIncomingConnection ? (
        <>
          <Handle
            type='target'
            id={getTargetHandleId('top')}
            position={Position.Top}
            className='!h-3.5 !w-3.5 !rounded-full !border-2 !border-black !bg-[#FFE234]'
          />
          <Handle
            type='target'
            id={getTargetHandleId('right')}
            position={Position.Right}
            className='!h-3.5 !w-3.5 !rounded-full !border-2 !border-black !bg-[#FFE234]'
          />
          <Handle
            type='target'
            id={getTargetHandleId('bottom')}
            position={Position.Bottom}
            className='!h-3.5 !w-3.5 !rounded-full !border-2 !border-black !bg-[#FFE234]'
          />
          <Handle
            type='target'
            id={getTargetHandleId('left')}
            position={Position.Left}
            className='!h-3.5 !w-3.5 !rounded-full !border-2 !border-black !bg-[#FFE234]'
          />
        </>
      ) : null}

      <div className='overflow-hidden rounded-2xl border-2 border-black bg-white shadow-[4px_4px_0_#1A1A1A]'>
        {/* header */}
        <div className='flex items-center justify-between border-b-2 border-black bg-[#FFE234] px-4 py-2.5'>
          <span className='text-xs font-black uppercase tracking-widest'>
            Story
          </span>
          {nodeData.mode === 'markdown' && wordCount > 0 ? (
            <span className='font-mono text-[10px] text-black/50'>
              {wordCount.toLocaleString()} words
            </span>
          ) : null}
        </div>

        <div className='p-4'>
          {/* Segmented mode tabs */}
          <div className='mb-3 flex overflow-hidden rounded-xl border-2 border-black'>
            <button
              type='button'
              className={`nodrag flex-1 py-1.5 text-xs font-bold uppercase tracking-wide transition ${
                nodeData.mode === 'markdown'
                  ? 'bg-[#1A1A1A] text-[#FFE234]'
                  : 'bg-white text-foreground hover:bg-[#F7F4EC]'
              }`}
              onClick={() => nodeData.onModeChange('markdown')}>
              Markdown
            </button>
            <div className='w-0.5 bg-black' />
            <button
              type='button'
              className={`nodrag flex-1 py-1.5 text-xs font-bold uppercase tracking-wide transition ${
                nodeData.mode === 'google_docs'
                  ? 'bg-[#1A1A1A] text-[#FFE234]'
                  : 'bg-white text-foreground hover:bg-[#F7F4EC]'
              }`}
              onClick={() => nodeData.onModeChange('google_docs')}>
              Google Docs
            </button>
          </div>

          {nodeData.mode === 'markdown' ? (
            <div className='space-y-3'>
              {/* Editor */}
              <div className='relative'>
                <div
                  ref={editorRef}
                  contentEditable
                  suppressContentEditableWarning
                  role='textbox'
                  aria-multiline='true'
                  onInput={(event) => {
                    nodeData.onMarkdownChange(
                      readEditablePlainText(event.currentTarget),
                    );

                    const nextSelection = getSelectionOffsetsWithin(
                      event.currentTarget,
                    );
                    if (nextSelection) {
                      nodeData.onSelectionChange(
                        nextSelection.start,
                        nextSelection.end,
                      );
                    }
                  }}
                  onKeyUp={(event) => {
                    const nextSelection = getSelectionOffsetsWithin(
                      event.currentTarget,
                    );
                    if (nextSelection) {
                      nodeData.onSelectionChange(
                        nextSelection.start,
                        nextSelection.end,
                      );
                    }
                  }}
                  onMouseUp={(event) => {
                    const nextSelection = getSelectionOffsetsWithin(
                      event.currentTarget,
                    );
                    if (nextSelection) {
                      nodeData.onSelectionChange(
                        nextSelection.start,
                        nextSelection.end,
                      );
                    }
                  }}
                  onPaste={(event) => {
                    event.preventDefault();
                    const text = event.clipboardData.getData('text/plain');
                    const selection = window.getSelection();
                    if (!selection || selection.rangeCount === 0) {
                      return;
                    }

                    selection.deleteFromDocument();
                    selection
                      .getRangeAt(0)
                      .insertNode(document.createTextNode(text));
                    selection.collapseToEnd();
                  }}
                  className='nodrag nowheel nopan h-120 w-full cursor-text overflow-y-auto rounded-xl border-2 border-black bg-[#FDFBF5] px-4 py-3 font-mono text-sm leading-7 whitespace-pre-wrap focus:outline-none focus:ring-2 focus:ring-[#FFE234]'>
                  {nodeData.pendingProposal ? (
                    <>
                      <span>{pendingSelection.before}</span>
                      <span className='rounded-[0.25rem] bg-amber-200/70 shadow-[inset_0_-2px_0_#D97706]'>
                        {pendingSelection.highlight || ' '}
                      </span>
                      <span>{pendingSelection.after}</span>
                    </>
                  ) : (
                    nodeData.markdownInput
                  )}
                </div>
                {/* Scroll fade */}
                <div className='pointer-events-none absolute bottom-0 left-0 right-0 h-7 rounded-b-xl bg-gradient-to-t from-[#FDFBF5] to-transparent' />
              </div>

              {/* Pending proposal — git diff card */}
              {nodeData.pendingProposal ? (
                <div className='overflow-hidden rounded-2xl border-2 border-black shadow-[4px_4px_0_#1A1A1A]'>
                  {/* Card header */}
                  <div className='flex items-center justify-between border-b-2 border-black bg-[#FFE234] px-4 py-2'>
                    <div className='flex items-center gap-2'>
                      <span className='inline-block h-2 w-2 animate-pulse rounded-full bg-black' />
                      <span className='font-mono text-[10px] font-black uppercase tracking-widest'>
                        Suggested Rewrite
                      </span>
                    </div>
                    <span className='rounded-full border border-black/20 bg-white/70 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-black/60'>
                      {sourceLabel}
                    </span>
                  </div>

                  {/* Summary */}
                  {nodeData.pendingProposal.summary ? (
                    <div className='border-b border-black/10 bg-[#FAFAF8] px-4 py-2.5'>
                      <p className='text-sm font-semibold leading-snug text-foreground/80'>
                        {nodeData.pendingProposal.summary}
                      </p>
                    </div>
                  ) : null}

                  {/* Diff view */}
                  <div className='divide-y-2 divide-black/10 font-mono text-xs'>
                    <div className='flex bg-[#FFF2F2]'>
                      <div className='flex w-8 flex-shrink-0 select-none items-start justify-center pt-2.5 font-black text-[#CC2200]'>
                        −
                      </div>
                      <div className='flex-1 whitespace-pre-wrap py-2.5 pr-4 leading-relaxed text-[#AA1500]/75 line-through'>
                        {nodeData.pendingProposal.selectionText}
                      </div>
                    </div>
                    <div className='flex bg-[#F0FFF4]'>
                      <div className='flex w-8 flex-shrink-0 select-none items-start justify-center pt-2.5 font-black text-[#166534]'>
                        +
                      </div>
                      <div className='flex-1 whitespace-pre-wrap py-2.5 pr-4 leading-relaxed text-[#166534]'>
                        {nodeData.pendingProposal.replacementText}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className='flex gap-2 border-t-2 border-black bg-white p-3'>
                    <button
                      type='button'
                      className='nodrag flex-1 rounded-xl border-2 border-black bg-[#1A1A1A] py-2 text-sm font-bold uppercase tracking-wide text-[#FFE234] shadow-[3px_3px_0_#4A4A4A] transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[1px_1px_0_#4A4A4A] disabled:opacity-50'
                      disabled={nodeData.rewriteBusy}
                      onClick={nodeData.onAcceptRewrite}>
                      ✓ Accept &amp; Commit
                    </button>
                    <button
                      type='button'
                      className='nodrag rounded-2xl border-2 border-black bg-white px-6 py-2 text-sm font-bold uppercase tracking-wide text-foreground transition hover:bg-[#F7F4EC] disabled:opacity-50'
                      disabled={nodeData.rewriteBusy}
                      onClick={nodeData.onRejectRewrite}>
                      Dismiss
                    </button>
                  </div>
                </div>
              ) : null}

              {/* Rewrite command bar */}
              <div className='overflow-hidden rounded-2xl border-2 border-black bg-[#F7F4EC]'>
                <div className='flex items-center justify-between border-b border-black/15 px-4 py-2'>
                  <div className='flex items-center gap-2'>
                    <span className='font-mono text-[10px] font-bold uppercase tracking-widest text-black/50'>
                      Rewrite
                    </span>
                    {selectionPreview ? (
                      <span className='rounded-full bg-[#FFE234] px-2 py-0.5 font-mono text-[10px] font-bold text-black'>
                        {charCount} chars selected
                      </span>
                    ) : null}
                  </div>
                  {!selectionPreview ? (
                    <span className='font-mono text-[10px] text-black/40'>
                      Select text in the editor above
                    </span>
                  ) : null}
                </div>
                <div className='flex items-center gap-2 p-3'>
                  <input
                    value={nodeData.rewriteInstruction}
                    onChange={(event) =>
                      nodeData.onRewriteInstructionChange(event.target.value)
                    }
                    placeholder={
                      selectionPreview
                        ? 'Describe the rewrite...'
                        : 'Select text above first'
                    }
                    className='nodrag nowheel nopan h-10 flex-1 rounded-xl border-2 border-black bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#FFE234]'
                  />
                  <button
                    type='button'
                    className='nodrag rounded-xl border-2 border-black bg-[#1A1A1A] px-5 py-2 text-sm font-bold uppercase tracking-wide text-[#FFE234] shadow-[3px_3px_0_#4A4A4A] transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[1px_1px_0_#4A4A4A] disabled:opacity-40'
                    disabled={
                      nodeData.rewriteBusy ||
                      !selectionPreview ||
                      !nodeData.rewriteInstruction.trim() ||
                      !nodeData.activeProjectId.trim()
                    }
                    onClick={nodeData.onCreateRewrite}>
                    {nodeData.rewriteBusy ? '…' : 'Suggest'}
                  </button>
                </div>
              </div>
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
                className='nodrag nowheel nopan h-10 w-full rounded-lg border-2 border-black bg-[#F7F4EC] px-3 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-black'
              />
              <button
                type='button'
                className='nodrag w-full rounded-xl border-2 border-black bg-[#1A1A1A] py-2 text-sm font-bold uppercase tracking-wide text-[#FFE234] shadow-[3px_3px_0_#4A4A4A] transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[1px_1px_0_#4A4A4A] disabled:opacity-50'
                disabled={nodeData.busy || !nodeData.activeProjectId.trim()}
                onClick={nodeData.onFetchGoogleDocs}>
                {nodeData.busy ? 'Fetching...' : 'Fetch From Google Docs'}
              </button>
            </div>
          )}

          {nodeData.status && nodeData.mode !== 'markdown' ? (
            <p className='mt-2 font-mono text-xs text-muted-foreground'>
              {nodeData.status}
            </p>
          ) : null}
          {nodeData.error ? (
            <p className='mt-2 font-mono text-xs text-[#FF6B6B]'>
              {nodeData.error}
            </p>
          ) : null}
          {nodeData.rewriteStatus ? (
            <p className='mt-2 font-mono text-xs text-muted-foreground'>
              {nodeData.rewriteStatus}
            </p>
          ) : null}
          {nodeData.rewriteError ? (
            <p className='mt-2 font-mono text-xs text-[#FF6B6B]'>
              {nodeData.rewriteError}
            </p>
          ) : null}

          {/* Commit log — timeline */}
          {nodeData.revisions.length ? (
            <div className='mt-4'>
              <div className='mb-3 flex items-center gap-3'>
                <span className='font-mono text-[10px] font-bold uppercase tracking-widest text-black/50'>
                  Commit Log
                </span>
                <div className='flex-1 border-t border-dashed border-black/20' />
              </div>
              <div className='relative space-y-0 pl-5'>
                <div className='absolute bottom-0 left-1.5 top-1 w-px bg-black/10' />
                {nodeData.revisions.slice(0, 3).map((revision) => (
                  <div key={revision.id} className='relative pb-3'>
                    <div className='absolute -left-[15px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-black bg-[#FFE234]' />
                    <div className='rounded-lg border border-black/15 bg-white px-3 py-2'>
                      <div className='flex items-start justify-between gap-2'>
                        <p className='text-xs font-semibold leading-snug text-foreground'>
                          {revision.summary}
                        </p>
                        <p className='shrink-0 font-mono text-[10px] text-black/40'>
                          {revision.acceptedAt
                            ? new Date(revision.acceptedAt).toLocaleString(
                                undefined,
                                {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                },
                              )
                            : 'Accepted'}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {nodeData.mode === 'markdown' ? (
            <div className='mt-3 flex justify-end'>
              <p className='font-mono text-xs text-muted-foreground'>
                {nodeData.busy
                  ? 'Saving...'
                  : nodeData.status === 'Autosaved'
                    ? '✓ Saved'
                    : nodeData.status === 'Autosave failed'
                      ? '✗ Save failed'
                      : nodeData.status || 'Autosave'}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CharacterCardNodeComponent({
  data,
}: NodeProps<CharacterCardCanvasNode>) {
  return (
    <div className='relative w-115 overflow-visible'>
      {data.hasIncomingConnection ? (
        <>
          <Handle
            type='target'
            id={getTargetHandleId('top')}
            position={Position.Top}
            className='!h-3.5 !w-3.5 !rounded-full !border-2 !border-black !bg-[#FFE234]'
          />
          <Handle
            type='target'
            id={getTargetHandleId('right')}
            position={Position.Right}
            className='!h-3.5 !w-3.5 !rounded-full !border-2 !border-black !bg-[#FFE234]'
          />
          <Handle
            type='target'
            id={getTargetHandleId('bottom')}
            position={Position.Bottom}
            className='!h-3.5 !w-3.5 !rounded-full !border-2 !border-black !bg-[#FFE234]'
          />
          <Handle
            type='target'
            id={getTargetHandleId('left')}
            position={Position.Left}
            className='!h-3.5 !w-3.5 !rounded-full !border-2 !border-black !bg-[#FFE234]'
          />
        </>
      ) : null}
      {data.hasOutgoingConnection ? (
        <>
          <Handle
            type='source'
            id={getSourceHandleId('top')}
            position={Position.Top}
            className='!h-3.5 !w-3.5 !rounded-full !border-2 !border-black !bg-[#CCFF00]'
          />
          <Handle
            type='source'
            id={getSourceHandleId('right')}
            position={Position.Right}
            className='!h-3.5 !w-3.5 !rounded-full !border-2 !border-black !bg-[#CCFF00]'
          />
          <Handle
            type='source'
            id={getSourceHandleId('bottom')}
            position={Position.Bottom}
            className='!h-3.5 !w-3.5 !rounded-full !border-2 !border-black !bg-[#CCFF00]'
          />
          <Handle
            type='source'
            id={getSourceHandleId('left')}
            position={Position.Left}
            className='!h-3.5 !w-3.5 !rounded-full !border-2 !border-black !bg-[#CCFF00]'
          />
        </>
      ) : null}

      <div className='overflow-hidden rounded-2xl border-2 border-black bg-white shadow-[4px_4px_0_#1A1A1A]'>
        {/* header */}
        <div className='flex items-center gap-2 border-b-2 border-black bg-[#FF6B6B] px-4 py-2.5'>
          <span className='text-xs font-black uppercase tracking-widest'>
            Character
          </span>
        </div>

        <div className='space-y-3 p-4'>
          <div className='rounded-xl border-2 border-black bg-[#F7F4EC] px-4 py-3'>
            <input
              value={data.name}
              onChange={(event) => data.onNameChange(event.target.value)}
              placeholder='Character name'
              className='nodrag nowheel nopan w-full border-0 bg-transparent text-center text-lg font-black leading-tight outline-none placeholder:text-black/30'
            />
          </div>
          <div className='min-h-22 rounded-xl border-2 border-black bg-[#F7F4EC] px-4 py-3'>
            <textarea
              value={data.description}
              onChange={(event) => data.onDescriptionChange(event.target.value)}
              placeholder='Short description of who this character is'
              className='nodrag nowheel nopan min-h-16 w-full resize-y border-0 bg-transparent text-sm leading-snug text-foreground/90 outline-none'
            />
          </div>
        </div>

        <div className='mx-4 mb-4 min-h-52 rounded-xl border-2 border-black bg-[#F7F4EC] px-4 py-4'>
          <p className='mb-2 font-mono text-[10px] font-bold uppercase tracking-widest text-black/50'>
            Traits · Behaviour · Style
          </p>
          <textarea
            value={data.traitsText}
            onChange={(event) => data.onTraitsChange(event.target.value)}
            placeholder={
              'Behavior: ...\nStyle: ...\nPersonality: ...\nGoals: ...\nNotes: ...'
            }
            className='nodrag nowheel nopan min-h-44 w-full resize-y border-0 bg-transparent font-mono text-sm leading-relaxed text-foreground/90 outline-none'
          />
        </div>

        <div className='flex justify-end px-4 pb-3'>
          <p className='font-mono text-xs text-muted-foreground'>
            {data.saveState === 'saving'
              ? 'Saving...'
              : data.saveState === 'saved'
                ? '✓ Saved'
                : data.saveState === 'error'
                  ? data.saveMessage || '✗ Save failed'
                  : data.saveMessage || 'Autosave'}
          </p>
        </div>
      </div>
    </div>
  );
}

function StyleCardNodeComponent({ data }: NodeProps<StyleCardCanvasNode>) {
  return (
    <div className='relative w-130 overflow-visible'>
      {data.hasOutgoingConnection ? (
        <>
          <Handle
            type='source'
            id={getSourceHandleId('top')}
            position={Position.Top}
            className='!h-3.5 !w-3.5 !rounded-full !border-2 !border-black !bg-[#CCFF00]'
          />
          <Handle
            type='source'
            id={getSourceHandleId('right')}
            position={Position.Right}
            className='!h-3.5 !w-3.5 !rounded-full !border-2 !border-black !bg-[#CCFF00]'
          />
          <Handle
            type='source'
            id={getSourceHandleId('bottom')}
            position={Position.Bottom}
            className='!h-3.5 !w-3.5 !rounded-full !border-2 !border-black !bg-[#CCFF00]'
          />
          <Handle
            type='source'
            id={getSourceHandleId('left')}
            position={Position.Left}
            className='!h-3.5 !w-3.5 !rounded-full !border-2 !border-black !bg-[#CCFF00]'
          />
        </>
      ) : null}

      <div className='overflow-hidden rounded-2xl border-2 border-black bg-white shadow-[4px_4px_0_#1A1A1A]'>
        {/* header */}
        <div className='flex items-center justify-between border-b-2 border-black bg-[#4ECDC4] px-4 py-2.5'>
          <span className='text-xs font-black uppercase tracking-widest'>
            Style Guide
          </span>
          <span className='font-mono text-xs font-bold'>
            {data.name || 'Project Style'}
          </span>
        </div>

        <div className='space-y-0 divide-y-2 divide-black p-0'>
          {[
            {
              label: 'Writing Style',
              value: data.writingStyle,
              placeholder:
                'Rewrite/retouch voice, diction, tone, and narration style.',
              onChange: data.onWritingStyleChange,
            },
            {
              label: 'Character Style',
              value: data.characterStyle,
              placeholder:
                'General character portrayal, voice consistency, and behavior framing.',
              onChange: data.onCharacterStyleChange,
            },
            {
              label: 'Art Style',
              value: data.artStyle,
              placeholder:
                'Visual language, camera mood, palette, and art direction.',
              onChange: data.onArtStyleChange,
            },
            {
              label: 'Storytelling Pacing',
              value: data.storytellingPacing,
              placeholder:
                'Rhythm, beat spacing, tension curve, and cadence guidance.',
              onChange: data.onStorytellingPacingChange,
            },
            {
              label: 'Additional Dimensions',
              value: data.extrasText,
              placeholder:
                'Humor: dry and situational\nDialogue density: sparse but sharp',
              onChange: data.onExtrasTextChange,
              mono: true,
            },
          ].map(({ label, value, placeholder, onChange, mono }) => (
            <div key={label} className='bg-[#F7F4EC] px-4 py-3'>
              <p
                className='mb-1.5 font-mono text-[10px] font-bold uppercase tracking-widest text-[#4ECDC4]'
                style={{ color: '#2A9E96' }}>
                {label}
              </p>
              <textarea
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder}
                className={`nodrag nowheel nopan min-h-16 w-full resize-y border-0 bg-transparent text-sm leading-relaxed text-foreground/90 outline-none ${mono ? 'font-mono' : ''}`}
              />
            </div>
          ))}
        </div>

        <div className='flex justify-end border-t-2 border-black bg-white px-4 py-2.5'>
          <p className='font-mono text-xs text-muted-foreground'>
            {data.saveState === 'saving'
              ? 'Saving...'
              : data.saveState === 'saved'
                ? '✓ Saved'
                : data.saveState === 'error'
                  ? data.saveMessage || '✗ Save failed'
                  : data.saveMessage || 'Autosave'}
          </p>
        </div>
      </div>
    </div>
  );
}

function StoryboardCardNodeComponent({
  data,
}: NodeProps<StoryboardCardCanvasNode>) {
  return (
    <div className='relative w-180 overflow-visible'>
      {data.hasIncomingConnection ? (
        <>
          <Handle
            type='target'
            id={getTargetHandleId('top')}
            position={Position.Top}
            className='!h-3.5 !w-3.5 !rounded-full !border-2 !border-black !bg-[#FFE234]'
          />
          <Handle
            type='target'
            id={getTargetHandleId('right')}
            position={Position.Right}
            className='!h-3.5 !w-3.5 !rounded-full !border-2 !border-black !bg-[#FFE234]'
          />
          <Handle
            type='target'
            id={getTargetHandleId('bottom')}
            position={Position.Bottom}
            className='!h-3.5 !w-3.5 !rounded-full !border-2 !border-black !bg-[#FFE234]'
          />
          <Handle
            type='target'
            id={getTargetHandleId('left')}
            position={Position.Left}
            className='!h-3.5 !w-3.5 !rounded-full !border-2 !border-black !bg-[#FFE234]'
          />
        </>
      ) : null}
      {data.hasOutgoingConnection ? (
        <>
          <Handle
            type='source'
            id={getSourceHandleId('top')}
            position={Position.Top}
            className='!h-3.5 !w-3.5 !rounded-full !border-2 !border-black !bg-[#CCFF00]'
          />
          <Handle
            type='source'
            id={getSourceHandleId('right')}
            position={Position.Right}
            className='!h-3.5 !w-3.5 !rounded-full !border-2 !border-black !bg-[#CCFF00]'
          />
          <Handle
            type='source'
            id={getSourceHandleId('bottom')}
            position={Position.Bottom}
            className='!h-3.5 !w-3.5 !rounded-full !border-2 !border-black !bg-[#CCFF00]'
          />
          <Handle
            type='source'
            id={getSourceHandleId('left')}
            position={Position.Left}
            className='!h-3.5 !w-3.5 !rounded-full !border-2 !border-black !bg-[#CCFF00]'
          />
        </>
      ) : null}

      <div className='overflow-hidden rounded-2xl border-2 border-black bg-white shadow-[4px_4px_0_#1A1A1A]'>
        {/* header */}
        <div className='flex items-center gap-3 border-b-2 border-black bg-[#FF9F1C] px-4 py-2.5'>
          <span className='text-xs font-black uppercase tracking-widest'>
            Storyboard
          </span>
          <input
            value={data.title}
            onChange={(event) => data.onTitleChange(event.target.value)}
            placeholder='Storyboard title'
            className='nodrag nowheel nopan flex-1 border-0 bg-transparent text-sm font-bold outline-none placeholder:text-black/30'
          />
        </div>

        <div className='space-y-3 p-4'>
          {!data.frames.length ? (
            <div className='rounded-xl border-2 border-black bg-[#FF9F1C]/20 p-4 text-sm font-medium'>
              {data.saveState === 'generating'
                ? data.saveMessage || 'Generating storyboard descriptions...'
                : 'No frames yet.'}
            </div>
          ) : null}

          {data.frames.map((frame) => (
            <div
              key={`${data.storyboardId}-${frame.frameNumber}`}
              className='overflow-hidden rounded-xl border-2 border-black bg-[#F7F4EC]'>
              <div className='flex items-center gap-2 border-b-2 border-black bg-[#FF9F1C]/30 px-3 py-1.5'>
                <span className='font-mono text-xs font-black'>
                  Frame {frame.frameNumber}
                </span>
              </div>
              <div className='p-3'>
                <div className='grid grid-cols-[220px_1fr] gap-3'>
                  <div className='space-y-2'>
                    <div className='flex h-32 items-center justify-center overflow-hidden rounded-xl border-2 border-black bg-white text-sm'>
                      {frame.imageUrl ? (
                        <img
                          src={frame.imageUrl}
                          alt={`Storyboard frame ${frame.frameNumber}`}
                          className='h-full w-full rounded-xl object-cover'
                          onError={(event) => {
                            const target = event.currentTarget;
                            const baseUrl = frame.imageUrl || '';
                            if (!baseUrl) {
                              return;
                            }

                            const retryCount = Number(
                              target.dataset.retryCount || '0',
                            );
                            if (retryCount >= 4) {
                              return;
                            }

                            target.dataset.retryCount = String(retryCount + 1);
                            window.setTimeout(
                              () => {
                                const separator = baseUrl.includes('?')
                                  ? '&'
                                  : '?';
                                target.src = `${baseUrl}${separator}retry=${Date.now()}`;
                              },
                              500 * (retryCount + 1),
                            );
                          }}
                        />
                      ) : frame.imageStatus === 'pending' ? (
                        <span className='animate-pulse font-mono text-xs text-muted-foreground'>
                          Generating...
                        </span>
                      ) : frame.imageStatus === 'failed' ? (
                        <button
                          type='button'
                          className='nodrag rounded-lg border-2 border-black bg-[#FF6B6B] px-2 py-1 font-mono text-xs font-bold'
                          onClick={() =>
                            data.onFrameRetryImage(frame.frameNumber)
                          }>
                          Failed · Retry
                        </button>
                      ) : (
                        <span className='font-mono text-xs text-muted-foreground'>
                          Frame image
                        </span>
                      )}
                    </div>
                  </div>

                  <textarea
                    value={frame.description}
                    onChange={(event) =>
                      data.onFrameDescriptionChange(
                        frame.frameNumber,
                        event.target.value,
                      )
                    }
                    placeholder='Detailed frame description, camera angle, action, character and design notes.'
                    className='nodrag nowheel nopan min-h-32 w-full resize-y rounded-xl border-2 border-black bg-white px-3 py-2 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-black'
                  />
                </div>

                <div className='mt-2 flex items-center justify-between gap-3'>
                  <p className='font-mono text-xs text-muted-foreground'>
                    {frame.cameraAngle || frame.cameraMovement
                      ? `${frame.cameraAngle || 'n/a'} / ${frame.cameraMovement || 'static'}`
                      : 'Camera in description'}
                  </p>
                  <label className='flex items-center gap-2 font-mono text-xs font-bold text-[#FF6B6B]'>
                    Duration
                    <input
                      type='number'
                      min={0.1}
                      step={0.1}
                      value={
                        Number.isFinite(frame.durationSeconds)
                          ? frame.durationSeconds
                          : 3
                      }
                      onChange={(event) =>
                        data.onFrameDurationChange(
                          frame.frameNumber,
                          Number(event.target.value),
                        )
                      }
                      className='nodrag nowheel nopan h-7 w-18 rounded-lg border-2 border-black bg-white px-2 font-mono text-xs outline-none'
                    />
                  </label>
                </div>
              </div>
            </div>
          ))}

          <button
            type='button'
            className='nodrag w-full rounded-xl border-2 border-black bg-[#CCFF00] py-3 text-sm font-black uppercase tracking-wide shadow-[3px_3px_0_#1A1A1A] transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[1px_1px_0_#1A1A1A]'
            onClick={data.onFrameAdd}>
            + Add Frame
          </button>
        </div>

        <div className='flex justify-end border-t-2 border-black bg-white px-4 py-2.5'>
          <p className='font-mono text-xs text-muted-foreground'>
            {data.saveState === 'generating'
              ? data.saveMessage || 'Generating storyboard...'
              : data.saveState === 'saving'
                ? 'Saving...'
                : data.saveState === 'saved'
                  ? '✓ Saved'
                  : data.saveState === 'error'
                    ? data.saveMessage || '✗ Save failed'
                    : data.saveMessage || 'Autosave'}
          </p>
        </div>
      </div>
    </div>
  );
}

function CharacterDesignNodeComponent({
  data,
}: NodeProps<CharacterDesignCanvasNode>) {
  const selected = data.options.find(
    (item) => item.id === data.selectedOptionId,
  );
  const isPickedMode = data.mode === 'picked';
  const displayName = data.characterName.trim() || 'Character';
  const [imageRetryByOptionId, setImageRetryByOptionId] = useState<
    Record<string, number>
  >({});

  const getImageRetryKey = (optionId: string, rawSrc: string) =>
    `${optionId}:${rawSrc}`;

  const resolveImageSrc = (optionId: string, rawSrc: string) => {
    if (!rawSrc || rawSrc.startsWith('data:')) {
      return rawSrc;
    }

    const retryCount =
      imageRetryByOptionId[getImageRetryKey(optionId, rawSrc)] ?? 0;
    if (!retryCount) {
      return rawSrc;
    }

    const separator = rawSrc.includes('?') ? '&' : '?';
    return `${rawSrc}${separator}retry=${retryCount}`;
  };

  const queueImageRetry = (optionId: string, rawSrc: string) => {
    if (!rawSrc || rawSrc.startsWith('data:')) {
      return;
    }

    const retryKey = getImageRetryKey(optionId, rawSrc);

    window.setTimeout(() => {
      setImageRetryByOptionId((current) => {
        const attempts = current[retryKey] ?? 0;
        if (attempts >= 2) {
          return current;
        }

        return {
          ...current,
          [retryKey]: attempts + 1,
        };
      });
    }, 300);
  };

  return (
    <div
      className={`relative overflow-visible ${
        isPickedMode ? 'w-120' : 'w-220'
      }`}>
      {data.hasIncomingConnection ? (
        <>
          <Handle
            type='target'
            id={getTargetHandleId('top')}
            position={Position.Top}
            className='!h-3.5 !w-3.5 !rounded-full !border-2 !border-black !bg-[#FFE234]'
          />
          <Handle
            type='target'
            id={getTargetHandleId('right')}
            position={Position.Right}
            className='!h-3.5 !w-3.5 !rounded-full !border-2 !border-black !bg-[#FFE234]'
          />
          <Handle
            type='target'
            id={getTargetHandleId('bottom')}
            position={Position.Bottom}
            className='!h-3.5 !w-3.5 !rounded-full !border-2 !border-black !bg-[#FFE234]'
          />
          <Handle
            type='target'
            id={getTargetHandleId('left')}
            position={Position.Left}
            className='!h-3.5 !w-3.5 !rounded-full !border-2 !border-black !bg-[#FFE234]'
          />
        </>
      ) : null}
      {data.hasOutgoingConnection ? (
        <>
          <Handle
            type='source'
            id={getSourceHandleId('top')}
            position={Position.Top}
            className='!h-3.5 !w-3.5 !rounded-full !border-2 !border-black !bg-[#CCFF00]'
          />
          <Handle
            type='source'
            id={getSourceHandleId('right')}
            position={Position.Right}
            className='!h-3.5 !w-3.5 !rounded-full !border-2 !border-black !bg-[#CCFF00]'
          />
          <Handle
            type='source'
            id={getSourceHandleId('bottom')}
            position={Position.Bottom}
            className='!h-3.5 !w-3.5 !rounded-full !border-2 !border-black !bg-[#CCFF00]'
          />
          <Handle
            type='source'
            id={getSourceHandleId('left')}
            position={Position.Left}
            className='!h-3.5 !w-3.5 !rounded-full !border-2 !border-black !bg-[#CCFF00]'
          />
        </>
      ) : null}

      <div className='overflow-hidden rounded-2xl border-2 border-black bg-white shadow-[4px_4px_0_#1A1A1A]'>
        {/* header */}
        <div className='flex items-center justify-between gap-3 border-b-2 border-black bg-[#C084FC] px-4 py-2.5'>
          <span className='text-xs font-black uppercase tracking-widest'>
            Design · {displayName}
          </span>
          {data.mode === 'options' ? (
            <div className='flex items-center gap-2'>
              {data.selectedOptionId ? (
                <button
                  type='button'
                  className='nodrag rounded-lg border-2 border-black bg-white px-3 py-1 text-xs font-bold uppercase shadow-[2px_2px_0_#1A1A1A] transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[0px_0px_0_#1A1A1A] disabled:opacity-50'
                  disabled={data.busy}
                  onClick={data.onCancel}>
                  Cancel
                </button>
              ) : null}
              <button
                type='button'
                className='nodrag rounded-lg border-2 border-black bg-[#1A1A1A] px-3 py-1 text-xs font-bold uppercase text-[#C084FC] shadow-[2px_2px_0_#4A4A4A] transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[0px_0px_0_#4A4A4A] disabled:opacity-50'
                disabled={data.busy}
                onClick={data.onRetry}>
                {data.busy ? 'Generating...' : 'Retry'}
              </button>
            </div>
          ) : (
            <button
              type='button'
              className='nodrag rounded-lg border-2 border-black bg-white px-3 py-1 text-xs font-bold uppercase shadow-[2px_2px_0_#1A1A1A] transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[0px_0px_0_#1A1A1A] disabled:opacity-50'
              disabled={data.busy}
              onClick={data.onEdit}>
              {data.busy ? 'Generating...' : 'Edit'}
            </button>
          )}
        </div>

        <div className='p-4'>
          {data.error ? (
            <p className='mb-3 rounded-lg border-2 border-black bg-[#FF6B6B]/20 px-3 py-2 font-mono text-xs text-[#FF6B6B]'>
              {data.error}
            </p>
          ) : null}

          {data.mode === 'picked' && selected ? (
            <button
              type='button'
              className='nodrag block w-full overflow-hidden rounded-2xl border-2 border-black bg-[#F7F4EC] p-2 shadow-[3px_3px_0_#1A1A1A] transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[1px_1px_0_#1A1A1A]'
              disabled={data.busy}
              onClick={data.onEdit}>
              <img
                src={resolveImageSrc(
                  selected.id,
                  selected.imageUrl || selected.imageDataUrl || '',
                )}
                alt={`${displayName} selected design`}
                className='aspect-square w-full rounded-xl object-cover'
                onError={() => {
                  queueImageRetry(
                    selected.id,
                    selected.imageUrl || selected.imageDataUrl || '',
                  );
                }}
              />
            </button>
          ) : (
            <div className='grid grid-cols-3 items-start gap-4'>
              {data.options.map((option) => {
                const isSelected = option.id === data.selectedOptionId;

                return (
                  <button
                    key={option.id}
                    type='button'
                    disabled={data.busy}
                    className={`nodrag overflow-hidden rounded-2xl border-2 border-black bg-[#F7F4EC] p-1 transition disabled:cursor-not-allowed disabled:opacity-60 ${
                      isSelected
                        ? 'shadow-[0px_0px_0_#1A1A1A] translate-x-0.5 translate-y-0.5'
                        : 'shadow-[3px_3px_0_#1A1A1A] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[1px_1px_0_#1A1A1A]'
                    }`}
                    onClick={() => data.onPick(option.id)}>
                    {isSelected ? (
                      <div className='absolute -right-1 -top-1 rounded-full border-2 border-black bg-[#C084FC] px-1.5 py-0.5 font-mono text-[10px] font-black'>
                        ✓
                      </div>
                    ) : null}
                    <img
                      src={resolveImageSrc(
                        option.id,
                        option.imageUrl || option.imageDataUrl || '',
                      )}
                      alt={`${displayName} design option`}
                      className='aspect-square w-full rounded-xl object-cover'
                      onError={() => {
                        queueImageRetry(
                          option.id,
                          option.imageUrl || option.imageDataUrl || '',
                        );
                      }}
                    />
                  </button>
                );
              })}
            </div>
          )}

          {!data.options.length ? (
            <p className='font-mono text-sm text-muted-foreground'>
              {data.busy
                ? 'Generating design options...'
                : 'No options yet. Use Retry to generate.'}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function mergeCaptionText(previous: string, rawIncoming: string): string {
  // prev is always stored trimmed; preserve raw incoming for spacing detection
  const prev = previous;
  const next = rawIncoming.trim();

  if (!next) {
    return prev;
  }

  if (!prev) {
    return next;
  }

  if (next === prev || prev.endsWith(` ${next}`)) {
    return prev;
  }

  // Cumulative transcription replacement: return whichever is longer
  if (next.startsWith(prev) || prev.startsWith(next)) {
    return next.length >= prev.length ? next : prev;
  }

  if (/^[.,!?;:]+$/.test(next)) {
    return `${prev}${next}`;
  }

  // Use leading space in rawIncoming as word-boundary signal.
  // Tokens without a leading space are mid-word fragments — join directly.
  const isNewWord = rawIncoming.startsWith(' ');
  return isNewWord ? `${prev} ${next}` : `${prev}${next}`;
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

function parseCharacterDesignOptions(profile: CharacterProfileRecord | null) {
  if (!profile || !Array.isArray(profile.characterDesigns)) {
    return [] as CharacterDesignOptionRecord[];
  }

  const parsed = profile.characterDesigns.map(
    (item): CharacterDesignOptionRecord | null => {
      const id = typeof item?.id === 'string' ? item.id.trim() : '';
      const imageUrlFromImageUrl =
        typeof item?.imageUrl === 'string' ? item.imageUrl.trim() : '';
      const imageUrlFromDataUrl =
        typeof item?.imageDataUrl === 'string' ? item.imageDataUrl.trim() : '';
      const imageUrl = imageUrlFromImageUrl || imageUrlFromDataUrl;
      if (!id || !imageUrl) {
        return null;
      }

      return {
        id,
        imageUrl,
        ...(imageUrlFromDataUrl ? { imageDataUrl: imageUrlFromDataUrl } : {}),
        ...(typeof item.prompt === 'string' ? { prompt: item.prompt } : {}),
        ...(typeof item.createdAt === 'string'
          ? { createdAt: item.createdAt }
          : {}),
      };
    },
  );

  return parsed.filter((item): item is CharacterDesignOptionRecord =>
    Boolean(item),
  );
}

function resolveSelectedCharacterDesignId(
  profile: CharacterProfileRecord | null,
  options: CharacterDesignOptionRecord[],
) {
  const selectedId =
    profile && typeof profile.selectedCharacterDesignId === 'string'
      ? profile.selectedCharacterDesignId.trim()
      : '';

  if (selectedId && options.some((item) => item.id === selectedId)) {
    return selectedId;
  }

  return options[0]?.id ?? '';
}

function resolvePersistedSelectedCharacterDesignId(
  profile: CharacterProfileRecord | null,
  options: CharacterDesignOptionRecord[],
) {
  const selectedId =
    profile && typeof profile.selectedCharacterDesignId === 'string'
      ? profile.selectedCharacterDesignId.trim()
      : '';

  if (selectedId && options.some((item) => item.id === selectedId)) {
    return selectedId;
  }

  return '';
}

function resolveDefaultCharacterDesignMode(
  profile: CharacterProfileRecord | null,
  options: CharacterDesignOptionRecord[],
): CharacterDesignUiState['mode'] {
  if (!options.length) {
    return 'options';
  }

  const persistedSelectedId = resolvePersistedSelectedCharacterDesignId(
    profile,
    options,
  );

  return persistedSelectedId ? 'picked' : 'options';
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

function parseStoryboardFrames(shotsJson?: string | null) {
  if (!shotsJson) {
    return [] as StoryboardFrameRecord[];
  }

  try {
    const parsed = JSON.parse(shotsJson);
    if (!Array.isArray(parsed)) {
      return [] as StoryboardFrameRecord[];
    }

    return parsed
      .map((item, index): StoryboardFrameRecord | null => {
        if (!item || typeof item !== 'object') {
          return null;
        }

        const record = item as Record<string, unknown>;
        const description =
          typeof record.description === 'string'
            ? record.description.trim()
            : '';

        const rawImageUrlCandidates = [
          record.imageUrl,
          record.imageURL,
          record.image_url,
          record.url,
        ];
        const imageUrl = rawImageUrlCandidates
          .map((value) => (typeof value === 'string' ? value.trim() : ''))
          .find(Boolean);

        const rawImageStatus =
          typeof record.imageStatus === 'string'
            ? record.imageStatus.trim().toLowerCase()
            : typeof record.status === 'string'
              ? record.status.trim().toLowerCase()
              : '';

        const imageStatus =
          rawImageStatus === 'pending' ||
          rawImageStatus === 'ready' ||
          rawImageStatus === 'failed'
            ? rawImageStatus
            : imageUrl
              ? 'ready'
              : description
                ? 'pending'
                : undefined;

        const rawCharacters = Array.isArray(record.characters)
          ? record.characters
          : [];
        const characters = rawCharacters
          .map((entry) => {
            if (!entry || typeof entry !== 'object') {
              return null;
            }

            const character = entry as Record<string, unknown>;
            const characterName =
              typeof character.characterName === 'string'
                ? character.characterName.trim()
                : '';
            const action =
              typeof character.action === 'string'
                ? character.action.trim()
                : '';
            const designCue =
              typeof character.designCue === 'string'
                ? character.designCue.trim()
                : '';

            if (!characterName || !action) {
              return null;
            }

            return {
              characterName,
              action,
              designCue,
            };
          })
          .filter(
            (
              character,
            ): character is {
              characterName: string;
              action: string;
              designCue: string;
            } => Boolean(character),
          );

        const rawDuration =
          typeof record.durationSeconds === 'number'
            ? record.durationSeconds
            : Number(record.durationSeconds);
        const durationSeconds =
          Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 3;

        const annotations = Array.isArray(record.annotations)
          ? record.annotations
              .filter(
                (annotation): annotation is string =>
                  typeof annotation === 'string',
              )
              .map((annotation) => annotation.trim())
              .filter(Boolean)
          : [];

        return {
          frameNumber: index + 1,
          description,
          cameraAngle:
            typeof record.cameraAngle === 'string'
              ? record.cameraAngle.trim()
              : '',
          cameraMovement:
            typeof record.cameraMovement === 'string'
              ? record.cameraMovement.trim()
              : '',
          characters,
          durationSeconds,
          annotations,
          ...(imageStatus ? { imageStatus } : {}),
          ...(imageUrl ? { imageUrl } : {}),
        };
      })
      .filter((frame): frame is StoryboardFrameRecord => Boolean(frame));
  } catch {
    return [] as StoryboardFrameRecord[];
  }
}

function buildStoryboardDraftFromRecord(
  storyboardNode: StoryboardNodeRecord,
): StoryboardDraftState {
  const frames = parseStoryboardFrames(storyboardNode.shotsJson);
  return {
    title: storyboardNode.title || 'Storyboard',
    frames,
    saveState: 'idle',
    saveMessage: 'Autosave',
    generationPhase: 'completed',
    isLocalDirty: false,
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

  // Pass raw text (before trim) so mergeCaptionText can use leading-space signal
  const merged = mergeCaptionText(last.text, text);
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
const CharacterDesignNode = memo(CharacterDesignNodeComponent);
const StyleCardNode = memo(StyleCardNodeComponent);
const StoryboardCardNode = memo(StoryboardCardNodeComponent);
const FLOW_NODE_TYPES = {
  storyImport: StoryImportNode,
  characterCard: CharacterCardNode,
  characterDesign: CharacterDesignNode,
  styleCard: StyleCardNode,
  storyboard: StoryboardCardNode,
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
  if (typeof text !== 'string' || !text.trim()) return null;
  // Preserve leading space — it is the word-boundary signal for mergeCaptionText.
  return text.trimEnd();
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
  if (typeof text !== 'string' || !text.trim()) return null;
  // Preserve leading space — it is the word-boundary signal for mergeCaptionText.
  return text.trimEnd();
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
  const [socketReady, setSocketReady] = useState(false);
  const [, setSocketStatus] = useState('connecting voice socket...');
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
  const [storyRewriteInstruction, setStoryRewriteInstruction] = useState('');
  const [storyRewriteSelection, setStoryRewriteSelection] = useState({
    start: 0,
    end: 0,
  });
  const [storyRewriteBusy, setStoryRewriteBusy] = useState(false);
  const [storyRewriteStatus, setStoryRewriteStatus] = useState('');
  const [storyRewriteError, setStoryRewriteError] = useState('');
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
  const [storyboardDrafts, setStoryboardDrafts] = useState<
    Record<string, StoryboardDraftState>
  >({});
  const [characterDesignUiState, setCharacterDesignUiState] = useState<
    Record<string, CharacterDesignUiState>
  >({});
  const [debugTextInput, setDebugTextInput] = useState('');
  const [projectListCard, setProjectListCard] = useState<
    ProjectListItem[] | null
  >(null);
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
  const storyboardAutosaveTimersRef = useRef<Map<string, number>>(new Map());
  const nodePositionSaveTimersRef = useRef<Map<string, number>>(new Map());
  const storyAutosaveTimerRef = useRef<number | null>(null);
  const lastSavedStoryMarkdownRef = useRef('');
  const lastSeenStoryRewriteToolCallIdRef = useRef('');
  const lastSavedNodePositionsRef = useRef<
    Record<string, { x: number; y: number }>
  >({});
  const characterDraftsRef = useRef<Record<string, CharacterDraftState>>({});
  const styleDraftsRef = useRef<Record<string, StyleDraftState>>({});
  const storyboardDraftsRef = useRef<Record<string, StoryboardDraftState>>({});
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
    storyboardDraftsRef.current = storyboardDrafts;
  }, [storyboardDrafts]);

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
      const characterDesignNodeIds = (projectGraph.characterNodes ?? []).map(
        (node) => `character-design-${node.id}`,
      );
      const storyboardNodeIds = (projectGraph.storyboardNodes ?? []).map(
        (node) => `storyboard-${node.id}`,
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

      characterNodeIds.forEach((sourceCharacterId) => {
        const characterId = sourceCharacterId.replace('character-', '');
        const targetDesignId = `character-design-${characterId}`;
        const sourcePosition = positionById.get(sourceCharacterId);
        const targetPosition = positionById.get(targetDesignId);
        if (!sourcePosition || !targetPosition) {
          return;
        }

        const sides = getNearestHandleSides({
          source: sourcePosition,
          target: targetPosition,
        });

        edges.push({
          id: `edge-${sourceCharacterId}-to-${targetDesignId}`,
          source: sourceCharacterId,
          target: targetDesignId,
          sourceHandle: getSourceHandleId(sides.source),
          targetHandle: getTargetHandleId(sides.target),
          type: 'smoothstep',
          animated: true,
          style: { strokeWidth: 2 },
          selectable: false,
          deletable: false,
        });
      });

      storyboardNodeIds.forEach((sourceStoryboardId) => {
        const sourcePosition = positionById.get(sourceStoryboardId);
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
              id: `edge-${sourceStoryboardId}-to-${storyNodeId}`,
              source: sourceStoryboardId,
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

        characterDesignNodeIds.forEach((targetDesignId) => {
          const targetPosition = positionById.get(targetDesignId);
          if (!targetPosition) {
            return;
          }

          const sides = getNearestHandleSides({
            source: sourcePosition,
            target: targetPosition,
          });

          edges.push({
            id: `edge-${sourceStoryboardId}-to-${targetDesignId}`,
            source: sourceStoryboardId,
            target: targetDesignId,
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
    const storyboardAutosaveTimers = storyboardAutosaveTimersRef.current;

    const client = createAgentSocket({
      projectId: initialProjectIdRef.current || undefined,
      onOpen: () => {
        setConnected(true);
        setSocketReady(false);
        setSocketStatus('voice socket connected, preparing session...');
        setVoiceState('idle');
      },
      onClose: () => {
        setConnected(false);
        setSocketReady(false);
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
          setSocketReady(true);
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
            setProjectListCard(null);

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
          const contextChanged =
            payload && typeof payload.contextChanged === 'boolean'
              ? payload.contextChanged
              : false;
          setActiveProjectId(activeProjectIdFromMessage);
          setProjectName(activeName || 'Active project');
          if (contextChanged) {
            setProjectListCard(null);
          }
          return;
        }

        if (message.type === 'agent.projects.listed') {
          const payload =
            message.payload && typeof message.payload === 'object'
              ? (message.payload as Record<string, unknown>)
              : null;
          const rawProjects =
            payload && Array.isArray(payload.projects) ? payload.projects : [];
          const items: ProjectListItem[] = rawProjects
            .filter(
              (p): p is Record<string, unknown> =>
                Boolean(p) && typeof p === 'object',
            )
            .map((p) => ({
              id: typeof p.id === 'string' ? p.id : '',
              name: typeof p.name === 'string' ? p.name : 'Untitled',
              updatedAt:
                typeof p.updatedAt === 'string'
                  ? p.updatedAt
                  : new Date().toISOString(),
              story:
                p.story && typeof p.story === 'object'
                  ? {
                      title:
                        typeof (p.story as Record<string, unknown>).title ===
                        'string'
                          ? ((p.story as Record<string, unknown>)
                              .title as string)
                          : '',
                    }
                  : null,
            }));
          setProjectListCard(items);
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

        if (message.type === 'agent.style.updated') {
          const payload =
            message.payload && typeof message.payload === 'object'
              ? (message.payload as Record<string, unknown>)
              : null;
          const updatedProjectId =
            payload && typeof payload.projectId === 'string'
              ? payload.projectId.trim()
              : '';

          if (
            updatedProjectId &&
            updatedProjectId !== activeProjectIdRef.current.trim()
          ) {
            return;
          }

          const styleNodeRaw =
            payload && typeof payload.styleNode === 'object'
              ? (payload.styleNode as Record<string, unknown>)
              : null;
          const styleNodeId =
            styleNodeRaw && typeof styleNodeRaw.id === 'string'
              ? styleNodeRaw.id
              : '';

          if (!styleNodeRaw || !styleNodeId) {
            return;
          }

          const updatedStyleNode: StyleNodeRecord = {
            id: styleNodeId,
            name:
              typeof styleNodeRaw.name === 'string'
                ? styleNodeRaw.name
                : 'Project Style Guide',
            description:
              typeof styleNodeRaw.description === 'string'
                ? styleNodeRaw.description
                : '',
            writingStyle:
              typeof styleNodeRaw.writingStyle === 'string'
                ? styleNodeRaw.writingStyle
                : null,
            characterStyle:
              typeof styleNodeRaw.characterStyle === 'string'
                ? styleNodeRaw.characterStyle
                : null,
            artStyle:
              typeof styleNodeRaw.artStyle === 'string'
                ? styleNodeRaw.artStyle
                : null,
            storytellingPacing:
              typeof styleNodeRaw.storytellingPacing === 'string'
                ? styleNodeRaw.storytellingPacing
                : null,
            extrasJson:
              typeof styleNodeRaw.extrasJson === 'string'
                ? styleNodeRaw.extrasJson
                : null,
            positionX:
              typeof styleNodeRaw.positionX === 'number'
                ? styleNodeRaw.positionX
                : null,
            positionY:
              typeof styleNodeRaw.positionY === 'number'
                ? styleNodeRaw.positionY
                : null,
          };

          setProjectGraph((current) => {
            if (!current) {
              return current;
            }

            const existing = current.styleNodes ?? [];
            const hasNode = existing.some((node) => node.id === styleNodeId);
            const nextStyleNodes = hasNode
              ? existing.map((node) =>
                  node.id === styleNodeId
                    ? { ...node, ...updatedStyleNode }
                    : node,
                )
              : [...existing, updatedStyleNode];

            return {
              ...current,
              styleNodes: nextStyleNodes,
            };
          });

          setStyleDrafts((current) => ({
            ...current,
            [styleNodeId]: {
              ...buildStyleDraftFromRecord(updatedStyleNode),
              saveState: 'saved',
              saveMessage: 'Saved',
            },
          }));

          return;
        }

        if (message.type === 'agent.status') {
          const payload =
            message.payload && typeof message.payload === 'object'
              ? (message.payload as Record<string, unknown>)
              : null;

          const sourceTool =
            payload && typeof payload.sourceTool === 'string'
              ? payload.sourceTool.trim()
              : '';
          const phase =
            payload && typeof payload.phase === 'string'
              ? payload.phase.trim().toLowerCase()
              : '';

          const statusMessage =
            payload && typeof payload.message === 'string'
              ? payload.message.trim()
              : '';

          if (statusMessage) {
            setSocketStatus(statusMessage);
            const shouldAppendCaption =
              sourceTool !== 'propose_story_rewrite' || phase !== 'started';

            if (shouldAppendCaption) {
              setCaptionLines((value) =>
                updateCaptionLines(value, 'Leo', statusMessage),
              );
            }
          }
          const statusProjectId =
            payload && typeof payload.projectId === 'string'
              ? payload.projectId.trim()
              : '';

          if (
            sourceTool === 'generate_character_design' &&
            (!statusProjectId || statusProjectId === activeProjectIdRef.current)
          ) {
            const ids =
              payload && Array.isArray(payload.characterNodeIds)
                ? payload.characterNodeIds
                    .filter((item): item is string => typeof item === 'string')
                    .map((item) => item.trim())
                    .filter(Boolean)
                : [];

            if (phase === 'started' && ids.length) {
              setCharacterDesignUiState((current) => {
                const next = { ...current };
                ids.forEach((id) => {
                  next[id] = {
                    ...(next[id] ?? {
                      mode: 'options' as const,
                      busy: false,
                      error: '',
                    }),
                    mode: 'options',
                    busy: true,
                    error: '',
                  };
                });
                return next;
              });
            }

            if (phase === 'completed') {
              setCharacterDesignUiState((current) => {
                if (!ids.length) {
                  const next: Record<string, CharacterDesignUiState> = {};
                  for (const [id, value] of Object.entries(current)) {
                    next[id] = {
                      ...value,
                      busy: false,
                    };
                  }
                  return next;
                }

                const next = { ...current };
                ids.forEach((id) => {
                  if (!next[id]) {
                    next[id] = {
                      mode: 'options',
                      busy: false,
                      error: '',
                    };
                    return;
                  }

                  next[id] = {
                    ...next[id],
                    busy: false,
                  };
                });
                return next;
              });
            }
          }

          if (
            (sourceTool === 'generate_storyboard' ||
              sourceTool === 'update_storyboard') &&
            (!statusProjectId || statusProjectId === activeProjectIdRef.current)
          ) {
            const phase =
              payload && typeof payload.phase === 'string'
                ? payload.phase.trim().toLowerCase()
                : '';
            const generationPhase =
              payload && typeof payload.generationPhase === 'string'
                ? payload.generationPhase.trim().toLowerCase()
                : '';
            const storyboardNodeId =
              payload && typeof payload.storyboardNodeId === 'string'
                ? payload.storyboardNodeId.trim()
                : '';

            const applyToIds = (
              current: Record<string, StoryboardDraftState>,
            ) =>
              storyboardNodeId
                ? Object.prototype.hasOwnProperty.call(
                    current,
                    storyboardNodeId,
                  )
                  ? [storyboardNodeId]
                  : []
                : Object.keys(current);

            if (phase === 'started') {
              setStoryboardDrafts((current) => {
                const ids = applyToIds(current);
                if (!ids.length) {
                  return current;
                }

                const next = { ...current };
                ids.forEach((id) => {
                  const draft = next[id];
                  if (!draft || draft.isLocalDirty) {
                    return;
                  }

                  next[id] = {
                    ...draft,
                    saveState: 'generating',
                    saveMessage: statusMessage || 'Generating storyboard...',
                    generationPhase: 'descriptions',
                  };
                });
                return next;
              });
            }

            if (phase === 'descriptions_progress') {
              setStoryboardDrafts((current) => {
                const ids = applyToIds(current);
                if (!ids.length) {
                  return current;
                }

                const next = { ...current };
                ids.forEach((id) => {
                  const draft = next[id];
                  if (!draft || draft.isLocalDirty) {
                    return;
                  }

                  next[id] = {
                    ...draft,
                    saveState: 'generating',
                    saveMessage:
                      statusMessage || 'Streaming storyboard descriptions...',
                    generationPhase: 'descriptions',
                  };
                });
                return next;
              });
            }

            if (
              phase === 'descriptions_completed' ||
              phase === 'images_started' ||
              phase === 'images_progress' ||
              generationPhase === 'images'
            ) {
              setStoryboardDrafts((current) => {
                const ids = applyToIds(current);
                if (!ids.length) {
                  return current;
                }

                const next = { ...current };
                ids.forEach((id) => {
                  const draft = next[id];
                  if (!draft || draft.isLocalDirty) {
                    return;
                  }

                  next[id] = {
                    ...draft,
                    saveState: 'generating',
                    saveMessage:
                      statusMessage ||
                      'Storyboard descriptions ready. Generating images...',
                    generationPhase: 'images',
                  };
                });
                return next;
              });
            }

            if (phase === 'completed') {
              setStoryboardDrafts((current) => {
                const ids = applyToIds(current);
                if (!ids.length) {
                  return current;
                }

                const next = { ...current };
                ids.forEach((id) => {
                  const draft = next[id];
                  if (!draft || draft.isLocalDirty) {
                    return;
                  }

                  next[id] = {
                    ...draft,
                    saveState: 'idle',
                    saveMessage: 'Autosave',
                    generationPhase: 'completed',
                  };
                });
                return next;
              });
            }
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

      for (const timerId of storyboardAutosaveTimers.values()) {
        window.clearTimeout(timerId);
      }
      storyboardAutosaveTimers.clear();
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

        if (!socketReady) {
          throw new Error('Voice session is still preparing. Try again now.');
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
        const processor = audioContext.createScriptProcessor(
          MIC_PROCESSOR_BUFFER_SIZE,
          1,
          1,
        );
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
    [connected, loopbackEnabled, socketReady, stopMicCapture],
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

    if (!connected || !socketReady) {
      setMicError('Voice session is not ready yet.');
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
  }, [connected, debugTextInput, socketReady]);

  useEffect(() => {
    const projectId = activeProjectId.trim();
    if (!projectId) {
      setProjectName('No active project');
      setProjectGraph(null);
      setNodes([]);
      setCharacterDrafts({});
      setStoryboardDrafts({});
      setCharacterDesignUiState({});
      for (const timerId of characterAutosaveTimersRef.current.values()) {
        window.clearTimeout(timerId);
      }
      characterAutosaveTimersRef.current.clear();
      for (const timerId of styleAutosaveTimersRef.current.values()) {
        window.clearTimeout(timerId);
      }
      styleAutosaveTimersRef.current.clear();
      for (const timerId of storyboardAutosaveTimersRef.current.values()) {
        window.clearTimeout(timerId);
      }
      storyboardAutosaveTimersRef.current.clear();
      for (const timerId of nodePositionSaveTimersRef.current.values()) {
        window.clearTimeout(timerId);
      }
      nodePositionSaveTimersRef.current.clear();
      if (storyAutosaveTimerRef.current) {
        window.clearTimeout(storyAutosaveTimerRef.current);
        storyAutosaveTimerRef.current = null;
      }
      lastSavedStoryMarkdownRef.current = '';
      lastSavedNodePositionsRef.current = {};
      setStoryMarkdownInput('');
      setStoryGoogleDocUrl('');
      setStoryImportStatus('');
      setStoryImportError('');
      setStoryRewriteInstruction('');
      setStoryRewriteSelection({ start: 0, end: 0 });
      setStoryRewriteStatus('');
      setStoryRewriteError('');
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
        lastSavedStoryMarkdownRef.current = (
          existingStory?.markdown ?? ''
        ).trim();
        setStoryImportStatus('');
        setStoryImportError('');
        setStoryRewriteInstruction('');
        setStoryRewriteStatus('');
        setStoryRewriteError('');
        setStoryRewriteSelection({ start: 0, end: 0 });
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
    if (!projectGraph?.characterNodes?.length) {
      setCharacterDesignUiState({});
      return;
    }

    setCharacterDesignUiState((current) => {
      const next: Record<string, CharacterDesignUiState> = {};

      for (const character of projectGraph.characterNodes ?? []) {
        const existing = current[character.id];
        if (existing?.busy) {
          next[character.id] = existing;
          continue;
        }

        const profile = parseCharacterProfile(character.profileJson);
        const options = parseCharacterDesignOptions(profile);
        const defaultMode = resolveDefaultCharacterDesignMode(profile, options);

        next[character.id] = {
          // Preserve explicit UI mode changes (e.g., picking an option).
          mode: existing?.mode ?? defaultMode,
          busy: false,
          error: existing?.error || '',
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

  useEffect(() => {
    if (!projectGraph?.storyboardNodes?.length) {
      setStoryboardDrafts({});
      return;
    }

    setStoryboardDrafts((current) => {
      const next: Record<string, StoryboardDraftState> = {};

      for (const storyboardNode of projectGraph.storyboardNodes ?? []) {
        const existing = current[storyboardNode.id];
        if (existing?.isLocalDirty) {
          next[storyboardNode.id] = existing;
          continue;
        }

        const derived = buildStoryboardDraftFromRecord(storyboardNode);
        next[storyboardNode.id] = {
          ...derived,
          saveState:
            existing?.saveState === 'saved'
              ? 'saved'
              : existing?.saveState === 'generating'
                ? 'generating'
                : 'idle',
          saveMessage:
            existing?.saveState === 'saved'
              ? 'Saved'
              : existing?.saveState === 'generating'
                ? existing.saveMessage || 'Generating storyboard...'
                : 'Autosave',
          generationPhase:
            existing?.saveState === 'generating'
              ? existing.generationPhase || 'descriptions'
              : 'completed',
          isLocalDirty: false,
        };
      }

      return next;
    });
  }, [projectGraph]);

  useEffect(() => {
    const pendingRewrite = getPendingStoryRewrite(projectGraph?.story);
    const toolCallId = pendingRewrite?.toolCallId?.trim() || '';

    if (!toolCallId) {
      lastSeenStoryRewriteToolCallIdRef.current = '';
      return;
    }

    if (toolCallId === lastSeenStoryRewriteToolCallIdRef.current) {
      return;
    }

    lastSeenStoryRewriteToolCallIdRef.current = toolCallId;
    setStoryRewriteInstruction(pendingRewrite?.instruction ?? '');

    const sourceLabel = formatRewriteSourceLabel(pendingRewrite?.source);
    setStoryRewriteStatus(
      sourceLabel === 'Leo via voice'
        ? 'Leo suggested an inline rewrite. Review it directly in the story.'
        : 'Pending rewrite suggestion is ready inline.',
    );
    setStoryRewriteError('');
  }, [projectGraph?.story]);

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
          lastSavedStoryMarkdownRef.current = (
            story.markdown ?? markdown
          ).trim();
        } else if (mode === 'markdown') {
          lastSavedStoryMarkdownRef.current = markdown;
        }

        setStoryImportStatus(
          mode === 'google_docs'
            ? 'Story fetched from Google Docs and saved.'
            : 'Autosaved',
        );
      } catch (error) {
        setStoryImportError(
          error instanceof Error ? error.message : 'Story import failed.',
        );
        if (mode === 'markdown') {
          setStoryImportStatus('Autosave failed');
        }
      } finally {
        setStoryImportBusy(false);
      }
    },
    [activeProjectId, storyGoogleDocUrl, storyMarkdownInput],
  );

  const createStoryRewriteProposal = useCallback(async () => {
    const projectId = activeProjectId.trim();
    if (!projectId) {
      setStoryRewriteError(
        'Select an active project before proposing a rewrite.',
      );
      return;
    }

    const selectionStart = Math.min(
      storyRewriteSelection.start,
      storyRewriteSelection.end,
    );
    const selectionEnd = Math.max(
      storyRewriteSelection.start,
      storyRewriteSelection.end,
    );
    const selectionText = storyMarkdownInput
      .slice(selectionStart, selectionEnd)
      .trim();
    const instruction = storyRewriteInstruction.trim();

    if (!selectionText) {
      setStoryRewriteError(
        'Highlight a section of the story before requesting a rewrite.',
      );
      return;
    }

    if (!instruction) {
      setStoryRewriteError(
        'Describe how you want the highlighted section to change.',
      );
      return;
    }

    setStoryRewriteBusy(true);
    setStoryRewriteStatus('Preparing pending rewrite...');
    setStoryRewriteError('');

    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/story/rewrite/proposals`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            instruction,
            selectionText,
            selectionStart,
            selectionEnd,
          }),
        },
      );

      const payload = (await response.json()) as StoryImportResponse;
      if (!response.ok) {
        throw new Error(
          payload.error || 'Failed to create story rewrite proposal.',
        );
      }

      if (payload.story) {
        setProjectGraph((current) =>
          current
            ? {
                ...current,
                story: payload.story,
              }
            : current,
        );
      }

      setStoryRewriteStatus('Pending rewrite ready for review.');
    } catch (error) {
      setStoryRewriteError(
        error instanceof Error
          ? error.message
          : 'Failed to create story rewrite proposal.',
      );
      setStoryRewriteStatus('');
    } finally {
      setStoryRewriteBusy(false);
    }
  }, [
    activeProjectId,
    storyMarkdownInput,
    storyRewriteInstruction,
    storyRewriteSelection.end,
    storyRewriteSelection.start,
  ]);

  const acceptStoryRewriteProposal = useCallback(async () => {
    const projectId = activeProjectId.trim();
    if (!projectId) {
      setStoryRewriteError(
        'Select an active project before accepting a rewrite.',
      );
      return;
    }

    setStoryRewriteBusy(true);
    setStoryRewriteStatus('Accepting pending rewrite...');
    setStoryRewriteError('');

    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/story/rewrite/accept`,
        {
          method: 'POST',
          credentials: 'include',
        },
      );

      const payload = (await response.json()) as StoryImportResponse;
      if (!response.ok) {
        throw new Error(
          payload.error ||
            (payload.stale
              ? 'Pending rewrite is stale. Regenerate it against the current story.'
              : 'Failed to accept story rewrite.'),
        );
      }

      if (payload.story) {
        setProjectGraph((current) =>
          current
            ? {
                ...current,
                story: payload.story,
              }
            : current,
        );
        setStoryMarkdownInput(payload.story.markdown ?? '');
        lastSavedStoryMarkdownRef.current = (
          payload.story.markdown ?? ''
        ).trim();
      }

      setStoryRewriteInstruction('');
      setStoryRewriteSelection({ start: 0, end: 0 });
      setStoryRewriteStatus('Rewrite accepted and committed to the story.');
    } catch (error) {
      setStoryRewriteError(
        error instanceof Error
          ? error.message
          : 'Failed to accept story rewrite.',
      );
      setStoryRewriteStatus('');
    } finally {
      setStoryRewriteBusy(false);
    }
  }, [activeProjectId]);

  const rejectStoryRewriteProposal = useCallback(async () => {
    const projectId = activeProjectId.trim();
    if (!projectId) {
      setStoryRewriteError(
        'Select an active project before rejecting a rewrite.',
      );
      return;
    }

    setStoryRewriteBusy(true);
    setStoryRewriteStatus('Discarding pending rewrite...');
    setStoryRewriteError('');

    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/story/rewrite/reject`,
        {
          method: 'POST',
          credentials: 'include',
        },
      );

      const payload = (await response.json()) as StoryImportResponse;
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to reject story rewrite.');
      }

      if (payload.story) {
        setProjectGraph((current) =>
          current
            ? {
                ...current,
                story: payload.story,
              }
            : current,
        );
      }

      setStoryRewriteStatus('Pending rewrite discarded.');
    } catch (error) {
      setStoryRewriteError(
        error instanceof Error
          ? error.message
          : 'Failed to reject story rewrite.',
      );
      setStoryRewriteStatus('');
    } finally {
      setStoryRewriteBusy(false);
    }
  }, [activeProjectId]);

  useEffect(() => {
    const projectId = activeProjectId.trim();
    const markdown = storyMarkdownInput.trim();

    if (storyAutosaveTimerRef.current) {
      window.clearTimeout(storyAutosaveTimerRef.current);
      storyAutosaveTimerRef.current = null;
    }

    if (
      !projectId ||
      storyImportMode !== 'markdown' ||
      storyImportBusy ||
      !markdown ||
      markdown === lastSavedStoryMarkdownRef.current
    ) {
      return;
    }

    setStoryImportStatus('Autosave pending...');
    setStoryImportError('');

    storyAutosaveTimerRef.current = window.setTimeout(() => {
      void importStoryForActiveProject('markdown');
      storyAutosaveTimerRef.current = null;
    }, 700);

    return () => {
      if (storyAutosaveTimerRef.current) {
        window.clearTimeout(storyAutosaveTimerRef.current);
        storyAutosaveTimerRef.current = null;
      }
    };
  }, [
    activeProjectId,
    importStoryForActiveProject,
    storyImportBusy,
    storyImportMode,
    storyMarkdownInput,
  ]);

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

  const regenerateCharacterDesign = useCallback(
    async (characterId: string) => {
      const projectId = activeProjectId.trim();
      if (!projectId) {
        return;
      }

      setCharacterDesignUiState((current) => ({
        ...current,
        [characterId]: {
          mode: 'options',
          busy: true,
          error: '',
        },
      }));

      try {
        const response = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/character-nodes/${encodeURIComponent(characterId)}/designs/regenerate`,
          {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ optionsCount: 3 }),
          },
        );

        const payload = (await response.json()) as
          | CharacterDesignRegenerateResponse
          | { error?: string };

        if (!response.ok || !payload || !('ok' in payload) || !payload.ok) {
          throw new Error(
            'error' in payload && typeof payload.error === 'string'
              ? payload.error
              : 'Failed to regenerate character design options.',
          );
        }

        if (payload.node) {
          setProjectGraph((current) => {
            if (!current) {
              return current;
            }

            return {
              ...current,
              characterNodes: (current.characterNodes ?? []).map((node) =>
                node.id === characterId ? { ...node, ...payload.node! } : node,
              ),
            };
          });
        }

        setCharacterDesignUiState((current) => ({
          ...current,
          [characterId]: {
            mode: 'options',
            busy: false,
            error: '',
          },
        }));
      } catch (error) {
        setCharacterDesignUiState((current) => ({
          ...current,
          [characterId]: {
            mode: 'options',
            busy: false,
            error:
              error instanceof Error
                ? error.message
                : 'Failed to regenerate character design options.',
          },
        }));
      }
    },
    [activeProjectId],
  );

  const selectCharacterDesign = useCallback(
    async (characterId: string, optionId: string) => {
      const projectId = activeProjectId.trim();
      if (!projectId) {
        return;
      }

      setCharacterDesignUiState((current) => ({
        ...current,
        [characterId]: {
          ...(current[characterId] ?? {
            mode: 'options' as const,
            busy: false,
            error: '',
          }),
          busy: true,
          error: '',
        },
      }));

      try {
        const response = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/character-nodes/${encodeURIComponent(characterId)}/design-selection`,
          {
            method: 'PATCH',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ optionId }),
          },
        );

        const payload = (await response.json()) as
          | CharacterDesignSelectionResponse
          | { error?: string };

        if (!response.ok || !payload || !('ok' in payload) || !payload.ok) {
          throw new Error(
            'error' in payload && typeof payload.error === 'string'
              ? payload.error
              : 'Failed to select character design.',
          );
        }

        if (payload.node) {
          setProjectGraph((current) => {
            if (!current) {
              return current;
            }

            return {
              ...current,
              characterNodes: (current.characterNodes ?? []).map((node) =>
                node.id === characterId ? { ...node, ...payload.node! } : node,
              ),
            };
          });
        }

        setCharacterDesignUiState((current) => ({
          ...current,
          [characterId]: {
            mode: 'picked',
            busy: false,
            error: '',
          },
        }));
      } catch (error) {
        setCharacterDesignUiState((current) => ({
          ...current,
          [characterId]: {
            ...(current[characterId] ?? {
              mode: 'options' as const,
              busy: false,
              error: '',
            }),
            busy: false,
            error:
              error instanceof Error
                ? error.message
                : 'Failed to select character design.',
          },
        }));
      }
    },
    [activeProjectId],
  );

  const editCharacterDesignSelection = useCallback((characterId: string) => {
    setCharacterDesignUiState((current) => ({
      ...(current[characterId]?.busy
        ? current
        : {
            ...current,
            [characterId]: {
              ...(current[characterId] ?? {
                mode: 'options' as const,
                busy: false,
                error: '',
              }),
              mode: 'options',
            },
          }),
    }));
  }, []);

  const cancelCharacterDesignEdit = useCallback((characterId: string) => {
    setCharacterDesignUiState((current) => {
      const existing = current[characterId];
      if (existing?.busy) {
        return current;
      }

      return {
        ...current,
        [characterId]: {
          ...(existing ?? {
            mode: 'options' as const,
            busy: false,
            error: '',
          }),
          mode: 'picked',
          error: '',
        },
      };
    });
  }, []);

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

  const saveStoryboardDraft = useCallback(
    async (storyboardId: string, draft: StoryboardDraftState) => {
      const projectId = activeProjectId.trim();
      if (!projectId) {
        return;
      }

      setStoryboardDrafts((current) => ({
        ...current,
        [storyboardId]: {
          ...draft,
          saveState: 'saving',
          saveMessage: 'Saving...',
        },
      }));

      try {
        const response = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/storyboard-nodes/${encodeURIComponent(storyboardId)}`,
          {
            method: 'PATCH',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              title: draft.title,
              frames: draft.frames,
            }),
          },
        );

        const payload = (await response.json()) as
          | StoryboardNodeUpdateResponse
          | undefined;

        if (!response.ok || !payload?.ok || !payload.node) {
          throw new Error(payload?.error || 'Failed to save storyboard.');
        }

        setStoryboardDrafts((current) => ({
          ...current,
          [storyboardId]: {
            ...draft,
            saveState: 'saved',
            saveMessage: 'Saved',
            isLocalDirty: false,
          },
        }));

        setProjectGraph((current) => {
          if (!current) {
            return current;
          }

          const nextStoryboardNodes = (current.storyboardNodes ?? []).map(
            (node) => (node.id === storyboardId ? payload.node! : node),
          );

          return {
            ...current,
            storyboardNodes: nextStoryboardNodes,
          };
        });
      } catch (error) {
        setStoryboardDrafts((current) => ({
          ...current,
          [storyboardId]: {
            ...draft,
            saveState: 'error',
            saveMessage:
              error instanceof Error
                ? error.message
                : 'Failed to save storyboard.',
            isLocalDirty: true,
          },
        }));
      }
    },
    [activeProjectId],
  );

  const queueStoryboardAutosave = useCallback(
    (storyboardId: string) => {
      const existingTimer =
        storyboardAutosaveTimersRef.current.get(storyboardId);
      if (existingTimer) {
        window.clearTimeout(existingTimer);
      }

      const nextTimer = window.setTimeout(() => {
        const latestDraft = storyboardDraftsRef.current[storyboardId];
        if (!latestDraft) {
          return;
        }

        void saveStoryboardDraft(storyboardId, latestDraft);
        storyboardAutosaveTimersRef.current.delete(storyboardId);
      }, 700);

      storyboardAutosaveTimersRef.current.set(storyboardId, nextTimer);
    },
    [saveStoryboardDraft],
  );

  const updateStoryboardDraft = useCallback(
    (
      storyboardId: string,
      updater: (draft: StoryboardDraftState) => StoryboardDraftState,
    ) => {
      setStoryboardDrafts((current) => {
        const existing = current[storyboardId];
        if (!existing) {
          return current;
        }

        return {
          ...current,
          [storyboardId]: {
            ...updater(existing),
            saveState: 'idle',
            saveMessage: 'Autosave pending...',
            isLocalDirty: true,
          },
        };
      });

      queueStoryboardAutosave(storyboardId);
    },
    [queueStoryboardAutosave],
  );

  const regenerateStoryboardFrameImage = useCallback(
    async (storyboardId: string, frameNumber: number) => {
      const projectId = activeProjectId.trim();
      if (!projectId) {
        return;
      }

      setStoryboardDrafts((current) => {
        const existing = current[storyboardId];
        if (!existing) {
          return current;
        }

        return {
          ...current,
          [storyboardId]: {
            ...existing,
            saveState: 'generating',
            saveMessage: `Retrying image for frame ${frameNumber}...`,
            generationPhase: 'images',
            isLocalDirty: false,
            frames: existing.frames.map((frame) =>
              frame.frameNumber === frameNumber
                ? {
                    ...frame,
                    imageStatus: 'pending',
                  }
                : frame,
            ),
          },
        };
      });

      try {
        const response = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/storyboard-nodes/${encodeURIComponent(storyboardId)}/regenerate-image`,
          {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ frameNumber }),
          },
        );

        const payload = (await response.json()) as
          | StoryboardImageRegenerateResponse
          | undefined;

        if (!payload?.node) {
          throw new Error(payload?.error || 'Failed to regenerate image.');
        }

        const refreshedDraft = buildStoryboardDraftFromRecord(payload.node);

        setProjectGraph((current) => {
          if (!current) {
            return current;
          }

          const nextStoryboardNodes = (current.storyboardNodes ?? []).map(
            (node) => (node.id === storyboardId ? payload.node! : node),
          );

          return {
            ...current,
            storyboardNodes: nextStoryboardNodes,
          };
        });

        setStoryboardDrafts((current) => ({
          ...current,
          [storyboardId]: {
            ...refreshedDraft,
            saveState: response.ok ? 'saved' : 'error',
            saveMessage: response.ok
              ? 'Image regenerated'
              : payload.error || 'Image regeneration failed',
            generationPhase: response.ok ? 'completed' : 'images',
            isLocalDirty: false,
          },
        }));
      } catch (error) {
        setStoryboardDrafts((current) => {
          const existing = current[storyboardId];
          if (!existing) {
            return current;
          }

          return {
            ...current,
            [storyboardId]: {
              ...existing,
              saveState: 'error',
              saveMessage:
                error instanceof Error
                  ? error.message
                  : 'Failed to regenerate image.',
              generationPhase: 'images',
              isLocalDirty: false,
              frames: existing.frames.map((frame) =>
                frame.frameNumber === frameNumber
                  ? {
                      ...frame,
                      imageStatus: 'failed',
                    }
                  : frame,
              ),
            },
          };
        });
      }
    },
    [activeProjectId],
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
      } else if (nodeId.startsWith('character-design-')) {
        return;
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
        if (nodeId.startsWith('character-design-')) {
          endpoint = `/api/projects/${encodeURIComponent(projectId)}/character-nodes/${encodeURIComponent(
            nodeId.replace('character-design-', ''),
          )}/design-position`;
        } else {
          endpoint = `/api/projects/${encodeURIComponent(projectId)}/character-nodes/${encodeURIComponent(
            nodeId.replace('character-', ''),
          )}/position`;
        }
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
        if (
          id.startsWith('character-') &&
          !id.startsWith('character-design-')
        ) {
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

        if (id.startsWith('storyboard-')) {
          const storyboardId = id.replace('storyboard-', '');
          const autosaveTimer =
            storyboardAutosaveTimersRef.current.get(storyboardId);
          if (autosaveTimer) {
            window.clearTimeout(autosaveTimer);
            storyboardAutosaveTimersRef.current.delete(storyboardId);
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
    const hasCharacterOutgoingConnections = characterNodes.length > 0;
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
      const selectionStart = Math.min(
        storyRewriteSelection.start,
        storyRewriteSelection.end,
      );
      const selectionEnd = Math.max(
        storyRewriteSelection.start,
        storyRewriteSelection.end,
      );
      const selectionText =
        selectionEnd > selectionStart
          ? storyMarkdownInput.slice(selectionStart, selectionEnd).trim()
          : '';
      const nodeData: StoryImportNodeData = {
        activeProjectId,
        hasIncomingConnection: hasStyleIncomingConnections,
        mode: storyImportMode,
        markdownInput: storyMarkdownInput,
        googleDocUrl: storyGoogleDocUrl,
        rewriteInstruction: storyRewriteInstruction,
        selectionText,
        selectionStart,
        selectionEnd,
        pendingProposal: getPendingStoryRewrite(projectGraph.story),
        revisions: projectGraph.story.revisions ?? [],
        busy: storyImportBusy,
        rewriteBusy: storyRewriteBusy,
        status: storyImportStatus,
        error: storyImportError,
        rewriteStatus: storyRewriteStatus,
        rewriteError: storyRewriteError,
        onModeChange: (mode) => {
          setStoryImportMode(mode);
          setStoryImportStatus('');
          setStoryImportError('');
        },
        onMarkdownChange: setStoryMarkdownInput,
        onSelectionChange: (start, end) => {
          setStoryRewriteSelection({ start, end });
          setStoryRewriteError('');
        },
        onGoogleDocUrlChange: setStoryGoogleDocUrl,
        onRewriteInstructionChange: (value) => {
          setStoryRewriteInstruction(value);
          setStoryRewriteError('');
        },
        onFetchGoogleDocs: () => {
          void importStoryForActiveProject('google_docs');
        },
        onCreateRewrite: () => {
          void createStoryRewriteProposal();
        },
        onAcceptRewrite: () => {
          void acceptStoryRewriteProposal();
        },
        onRejectRewrite: () => {
          void rejectStoryRewriteProposal();
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

      const characterPosition = resolveNodePosition(
        character.positionX,
        character.positionY,
        {
          x: 640,
          y: 120 + index * 440,
        },
      );

      const profile = parseCharacterProfile(character.profileJson);
      const designOptions = parseCharacterDesignOptions(profile);
      const selectedOptionId = resolveSelectedCharacterDesignId(
        profile,
        designOptions,
      );
      const defaultDesignMode = resolveDefaultCharacterDesignMode(
        profile,
        designOptions,
      );
      const designUi = characterDesignUiState[character.id] ?? {
        mode: defaultDesignMode,
        busy: false,
        error: '',
      };
      const persistedDesignPosition =
        profile?.characterDesignNodePosition &&
        Number.isFinite(profile.characterDesignNodePosition.x) &&
        Number.isFinite(profile.characterDesignNodePosition.y)
          ? {
              x: profile.characterDesignNodePosition.x,
              y: profile.characterDesignNodePosition.y,
            }
          : null;

      nextNodes.push({
        id: `character-${character.id}`,
        type: 'characterCard',
        position: characterPosition,
        data: {
          characterId: character.id,
          hasIncomingConnection: hasStyleIncomingConnections,
          hasOutgoingConnection: hasCharacterOutgoingConnections,
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

      nextNodes.push({
        id: `character-design-${character.id}`,
        type: 'characterDesign',
        position: resolveNodePosition(
          persistedDesignPosition?.x,
          persistedDesignPosition?.y,
          {
            x: characterPosition.x + 760,
            y: characterPosition.y,
          },
        ),
        draggable: true,
        deletable: false,
        data: {
          characterId: character.id,
          characterName: draft.name || character.name,
          hasIncomingConnection: true,
          hasOutgoingConnection: false,
          options: designOptions,
          selectedOptionId,
          mode: designUi.mode,
          busy: designUi.busy,
          error: designUi.error,
          onRetry: () => {
            void regenerateCharacterDesign(character.id);
          },
          onPick: (optionId: string) => {
            void selectCharacterDesign(character.id, optionId);
          },
          onEdit: () => {
            editCharacterDesignSelection(character.id);
          },
          onCancel: () => {
            cancelCharacterDesignEdit(character.id);
          },
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

    const storyboardNodes = projectGraph.storyboardNodes ?? [];
    storyboardNodes.forEach((storyboard, index) => {
      const derived = buildStoryboardDraftFromRecord(storyboard);
      const draft = storyboardDrafts[storyboard.id] ?? {
        ...derived,
        saveState: 'idle',
        saveMessage: 'Autosave',
      };

      nextNodes.push({
        id: `storyboard-${storyboard.id}`,
        type: 'storyboard',
        position: resolveNodePosition(
          storyboard.positionX,
          storyboard.positionY,
          {
            x: 1320,
            y: 120 + index * 190,
          },
        ),
        data: {
          storyboardId: storyboard.id,
          hasIncomingConnection: false,
          hasOutgoingConnection: true,
          title: draft.title,
          frames: draft.frames,
          saveState: draft.saveState,
          saveMessage: draft.saveMessage,
          onTitleChange: (value: string) => {
            updateStoryboardDraft(storyboard.id, (existing) => ({
              ...existing,
              title: value,
            }));
          },
          onFrameDescriptionChange: (frameNumber: number, value: string) => {
            updateStoryboardDraft(storyboard.id, (existing) => ({
              ...existing,
              frames: existing.frames.map((frame) =>
                frame.frameNumber === frameNumber
                  ? { ...frame, description: value }
                  : frame,
              ),
            }));
          },
          onFrameDurationChange: (frameNumber: number, value: number) => {
            const normalizedDuration =
              Number.isFinite(value) && value > 0 ? value : 0.1;
            updateStoryboardDraft(storyboard.id, (existing) => ({
              ...existing,
              frames: existing.frames.map((frame) =>
                frame.frameNumber === frameNumber
                  ? { ...frame, durationSeconds: normalizedDuration }
                  : frame,
              ),
            }));
          },
          onFrameRetryImage: (frameNumber: number) => {
            void regenerateStoryboardFrameImage(storyboard.id, frameNumber);
          },
          onFrameAdd: () => {
            updateStoryboardDraft(storyboard.id, (existing) => ({
              ...existing,
              frames: [
                ...existing.frames,
                {
                  frameNumber: existing.frames.length + 1,
                  description:
                    'Describe the frame action, camera, and character cues.',
                  cameraAngle: '',
                  cameraMovement: '',
                  characters: [],
                  durationSeconds: 3,
                  annotations: [],
                },
              ],
            }));
          },
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

    setNodes(finalNodes);

    setEdges(buildAutoStyleEdges(finalNodes));
  }, [
    activeProjectId,
    buildAutoStyleEdges,
    setEdges,
    acceptStoryRewriteProposal,
    createStoryRewriteProposal,
    importStoryForActiveProject,
    projectGraph,
    rejectStoryRewriteProposal,
    setNodes,
    storyGoogleDocUrl,
    storyImportBusy,
    storyImportError,
    storyImportMode,
    storyImportStatus,
    storyMarkdownInput,
    storyRewriteBusy,
    storyRewriteError,
    storyRewriteInstruction,
    storyRewriteSelection.end,
    storyRewriteSelection.start,
    storyRewriteStatus,
    characterDrafts,
    characterDesignUiState,
    styleDrafts,
    cancelCharacterDesignEdit,
    editCharacterDesignSelection,
    regenerateCharacterDesign,
    regenerateStoryboardFrameImage,
    selectCharacterDesign,
    storyboardDrafts,
    updateCharacterDraftField,
    updateStoryboardDraft,
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
    <div className='h-screen w-screen bg-background p-4 text-foreground'>
      <div
        className='relative h-full w-full overflow-hidden rounded-2xl border-2 border-black shadow-[6px_6px_0_#1A1A1A]'
        style={{ background: '#F7F4EC' }}>
        {/* ── Top-left: project name + debug link ── */}
        <div className='absolute left-5 top-5 z-10 flex items-center gap-2'>
          <div className='rounded-xl border-2 border-black bg-[#FFE234] px-4 py-2 shadow-[3px_3px_0_#1A1A1A]'>
            <span className='text-sm font-black uppercase tracking-wide'>
              {projectName}
            </span>
          </div>
          <button
            type='button'
            className='brut-shadow-hover rounded-xl border-2 border-black bg-white px-3 py-2 text-xs font-bold uppercase tracking-wide shadow-[2px_2px_0_#1A1A1A] hover:bg-[#EDEAD9]'
            onClick={() => navigate('/debug')}>
            Debug
          </button>
        </div>

        {/* ── Top-right: user + debug overlay ── */}
        <div className='absolute right-5 top-5 z-10 flex flex-col items-end gap-2'>
          <button
            type='button'
            className='flex h-10 w-10 items-center justify-center rounded-full border-2 border-black bg-white shadow-[2px_2px_0_#1A1A1A] hover:bg-[#EDEAD9]'>
            <User className='h-5 w-5' />
          </button>
          <p className='font-mono text-right text-[11px] text-muted-foreground'>
            {userName || 'profile'}
          </p>

          {debugOverlayEnabled ? (
            <div className='flex flex-col items-end gap-2'>
              <div
                className={`rounded-lg border-2 border-black px-2.5 py-1 text-xs font-bold uppercase shadow-[2px_2px_0_#1A1A1A] ${voiceState === 'active' ? 'bg-[#CCFF00]' : 'bg-white'}`}>
                voice: {voiceState}
              </div>
              <label className='flex items-center justify-end gap-2 font-mono text-xs text-muted-foreground'>
                <span>loopback</span>
                <input
                  type='checkbox'
                  checked={loopbackEnabled}
                  onChange={(event) => setLoopbackEnabled(event.target.checked)}
                  className='accent-[#1A1A1A]'
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
          style={{ background: '#F7F4EC' }}>
          <MiniMap
            pannable
            zoomable
            className='!rounded-xl !border-2 !border-black !shadow-[3px_3px_0_#1A1A1A]'
          />
          <Controls className='!rounded-xl !border-2 !border-black !shadow-[3px_3px_0_#1A1A1A] !bottom-5 !left-5' />
          <Background gap={24} size={1} color='#D4D0C4' />
        </ReactFlow>

        {!activeProjectId.trim() && !projectListCard && (
          <div className='pointer-events-none absolute inset-0 flex items-center justify-center'>
            <p className='font-black text-2xl uppercase tracking-widest text-[#1A1A1A]/25 select-none'>
              Let&apos;s work on something today
            </p>
          </div>
        )}

        {projectListCard && (
          <div className='pointer-events-none absolute inset-0 z-20 flex items-center justify-center'>
            <div className='w-full max-w-sm rounded-2xl border-2 border-black bg-white shadow-[6px_6px_0_#1A1A1A]'>
              <div className='border-b-2 border-black px-5 py-3'>
                <span className='text-xs font-black uppercase tracking-widest text-[#1A1A1A]'>
                  Your Projects
                </span>
              </div>
              {projectListCard.length === 0 ? (
                <div className='px-5 py-6 text-center font-mono text-sm text-muted-foreground'>
                  No projects yet.
                </div>
              ) : (
                <ul className='divide-y divide-black/10 px-0 py-0'>
                  {projectListCard.map((project) => (
                    <li
                      key={project.id}
                      className='flex items-center justify-between gap-4 px-5 py-3'>
                      <div className='min-w-0'>
                        <p className='truncate text-sm font-bold text-[#1A1A1A]'>
                          {project.name}
                        </p>
                        {project.story?.title ? (
                          <p className='truncate font-mono text-xs text-muted-foreground'>
                            {project.story.title}
                          </p>
                        ) : null}
                      </div>
                      <span className='shrink-0 font-mono text-[10px] text-muted-foreground'>
                        {new Date(project.updatedAt).toLocaleDateString(
                          undefined,
                          { month: 'short', day: 'numeric', year: 'numeric' },
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* ── Bottom: caption + mic controls ── */}
        <div className='absolute bottom-5 left-1/2 z-10 w-full max-w-xl -translate-x-1/2 px-4'>
          {ccEnabled && captionLines.length > 0 ? (
            <div className='mb-3 rounded-xl border-2 border-black bg-white/95 p-3 shadow-[3px_3px_0_#1A1A1A]'>
              <div className='space-y-1'>
                {captionLines.map((line, index) => (
                  <p
                    key={`${line.speaker}-${index}-${line.text}`}
                    className='font-mono text-xs text-muted-foreground'>
                    <span className='font-bold text-foreground'>
                      {line.speaker}:
                    </span>{' '}
                    {line.text}
                  </p>
                ))}
              </div>
            </div>
          ) : null}

          <div className='rounded-2xl border-2 border-black bg-white px-4 py-3 shadow-[4px_4px_0_#1A1A1A]'>
            <div className='flex items-center justify-center gap-3'>
              <button
                type='button'
                className={`brut-shadow-hover flex items-center gap-2 rounded-xl border-2 border-black px-4 py-2 text-sm font-bold uppercase shadow-[2px_2px_0_#1A1A1A] transition ${
                  ccEnabled ? 'bg-[#FFE234]' : 'bg-white hover:bg-[#EDEAD9]'
                }`}
                onClick={() => setCcEnabled((value) => !value)}>
                {ccEnabled ? (
                  <Captions className='h-4 w-4' />
                ) : (
                  <CaptionsOff className='h-4 w-4' />
                )}
                CC
              </button>

              <button
                type='button'
                className={`brut-shadow-hover flex min-w-28 items-center justify-center gap-2 rounded-xl border-2 border-black px-5 py-2 text-sm font-bold uppercase shadow-[2px_2px_0_#1A1A1A] transition ${
                  micActive ? 'bg-[#CCFF00]' : 'bg-white hover:bg-[#EDEAD9]'
                }`}
                onClick={() => void toggleMic()}>
                {micActive ? (
                  <Mic className='h-4 w-4' />
                ) : (
                  <MicOff className='h-4 w-4' />
                )}
                {micActive ? 'Mic On' : 'Mic'}
              </button>
            </div>

            {showInterruptedBadge ? (
              <div className='mt-2 flex justify-center'>
                <span className='rounded-md border-2 border-black bg-[#FF6B6B] px-3 py-0.5 font-mono text-xs font-bold'>
                  Leo interrupted
                </span>
              </div>
            ) : null}

            <p className='mt-2 text-center font-mono text-[11px] text-muted-foreground'>
              sent: {sentChunks} · ingested: {ingestedChunks}
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
                  className='nowheel nopan h-9 flex-1 rounded-lg border-2 border-black bg-[#F7F4EC] px-3 font-mono text-xs outline-none focus:ring-2 focus:ring-black'
                />
                <button
                  type='button'
                  className='brut-shadow-hover h-9 rounded-lg border-2 border-black bg-[#FFE234] px-3 font-mono text-xs font-bold shadow-[2px_2px_0_#1A1A1A] disabled:opacity-50'
                  disabled={
                    !debugTextInput.trim() || !connected || !socketReady
                  }
                  onClick={sendDebugTextInput}>
                  Send
                </button>
              </div>
            ) : null}

            {!micActive ? (
              <p className='mt-1 text-center font-mono text-[11px] text-muted-foreground'>
                Hold Space to push-to-talk
              </p>
            ) : null}
            {micError ? (
              <p className='mt-1 text-center font-mono text-[11px] text-[#FF6B6B]'>
                {micError}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
