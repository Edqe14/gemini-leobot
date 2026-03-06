import { GoogleGenAI, type GoogleGenAIOptions } from '@google/genai';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { prisma } from '../lib/db';
import { env } from '../lib/env';
import { z } from 'zod';
import { allocateNodePositions } from './node-position';
import type { AgentToolRuntimeEvent } from '../agents/types';

type ToolContext = {
  userId: string;
  projectId?: string;
  args: Record<string, unknown>;
  emitEvent?: (event: AgentToolRuntimeEvent) => void;
};

type StoryNodeSyncInput = {
  defaultTitle?: string;
  defaultTabType?: 'markdown' | 'google_docs';
  requestedStoryNodeId?: string;
};

type CharacterProfilePayload = {
  description?: string;
  headImageUrl?: string;
  behavior?: string;
  style?: string;
  personality?: string;
  goals?: string;
  notes?: string;
  attributes?: Record<string, string>;
  characterDesigns?: CharacterDesignOption[];
  selectedCharacterDesignId?: string;
  characterDesignPrompt?: string;
  characterDesignNodePosition?: {
    x: number;
    y: number;
  };
  characterDesignGeneratedAt?: string;
};

type CharacterDesignOption = {
  id: string;
  imageUrl: string;
  prompt: string;
  createdAt: string;
};

type CharacterDraftInput = {
  name: string;
  description: string;
  profile: CharacterProfilePayload;
};

type CharacterDraftParseResult =
  | {
      ok: true;
      drafts: CharacterDraftInput[];
      autoFromStory: boolean;
      maxCharacters: number;
    }
  | {
      ok: false;
      message: string;
      issues: string[];
    };

type ProjectStylePayload = {
  writingStyle: string;
  characterStyle: string;
  artStyle: string;
  storytellingPacing: string;
  extras: Record<string, string>;
};

type StoryboardFrameCharacter = {
  characterName: string;
  action: string;
  designCue: string;
};

type StoryboardFrame = {
  frameNumber: number;
  description: string;
  cameraAngle: string;
  cameraMovement: string;
  characters: StoryboardFrameCharacter[];
  durationSeconds: number;
  annotations: string[];
  imageStatus?: 'pending' | 'ready' | 'failed';
  imageUrl?: string;
};

type StoryboardCharacterDesignReference = {
  characterName: string;
  briefMarkdown: string;
  description: string;
  profileStyle: string;
  profileBehavior: string;
  selectedDesignId: string;
  selectedDesignPrompt: string;
  allDesigns: CharacterDesignOption[];
};

type StoryboardAttachedReferenceImage = {
  tag: string;
  characterName: string;
  designId: string;
  designPrompt: string;
  imageUrl: string;
  inlineData: {
    data: string;
    mimeType: string;
  };
};

type StyleRefineMode = 'direct' | 'subagent_refine';

const CHARACTER_CANONICAL_KEYS = new Set([
  'name',
  'description',
  'brief',
  'headImageUrl',
  'traits',
  'behavior',
  'behaviour',
  'style',
  'personality',
  'goals',
  'notes',
  'characterDesigns',
  'selectedCharacterDesignId',
  'characterDesignPrompt',
  'characterDesignNodePosition',
  'characterDesignGeneratedAt',
]);

const NON_CHARACTER_ENTITY_WORDS = new Set([
  'slack',
  'notion',
  'figma',
  'jira',
  'github',
  'gitlab',
  'google',
  'office',
  'city',
  'street',
  'building',
  'room',
  'app',
  'platform',
  'product',
  'software',
  'service',
  'tool',
  'api',
  'sdk',
  'server',
  'database',
  'workspace',
  'channel',
  'repo',
  'repository',
  'project',
]);

const CHARACTER_ACTION_HINTS = [
  'said',
  'asked',
  'replied',
  'looked',
  'walked',
  'ran',
  'felt',
  'thought',
  'smiled',
  'sighed',
  'nodded',
  'whispered',
  'laughed',
  'stared',
  'grabbed',
  'opened',
  'closed',
  'called',
  'worked',
  'typed',
  'sat',
  'stood',
  'moved',
  'checked',
  'found',
  'told',
  'warned',
  'promised',
  'decided',
  'helped',
  'pushed',
  'pulled',
];

const CHARACTER_PRONOUN_HINTS = [
  'he',
  'she',
  'they',
  'him',
  'her',
  'them',
  'his',
  'hers',
  'their',
];

const normalizedOptionalTextSchema = z
  .string()
  .trim()
  .max(8000)
  .optional()
  .transform((value) => value ?? '');

const characterInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: normalizedOptionalTextSchema,
    brief: normalizedOptionalTextSchema,
    headImageUrl: z.string().trim().max(2048).optional(),
    traits: z.record(z.string(), z.unknown()).optional(),
    behavior: normalizedOptionalTextSchema,
    style: normalizedOptionalTextSchema,
    personality: normalizedOptionalTextSchema,
    goals: normalizedOptionalTextSchema,
    notes: normalizedOptionalTextSchema,
  })
  .passthrough();

const characterInputArraySchema = z.array(characterInputSchema).min(1);

const characterAutoOptionsSchema = z.object({
  fromStory: z.boolean().optional(),
  maxCharacters: z.coerce.number().int().min(1).max(12).optional(),
});

const generatedCharacterTraitsSchema = z
  .object({
    behavior: normalizedOptionalTextSchema,
    style: normalizedOptionalTextSchema,
    personality: normalizedOptionalTextSchema,
    goals: normalizedOptionalTextSchema,
    notes: normalizedOptionalTextSchema,
  })
  .passthrough();

const generatedCharacterSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(320),
    headImageUrl: z
      .string()
      .trim()
      .max(2048)
      .optional()
      .transform((value) => value ?? ''),
    traits: generatedCharacterTraitsSchema.optional(),
  })
  .passthrough();

const generatedCharactersPayloadSchema = z.object({
  characters: z.array(generatedCharacterSchema).min(1).max(12),
});

const characterDesignToolArgsSchema = z.object({
  characterName: z.string().trim().min(1).max(120).optional(),
  optionsCount: z.coerce.number().int().min(1).max(4).optional(),
  replaceExisting: z.boolean().optional(),
});

const characterBriefUpdateArgsSchema = z
  .object({
    characterNodeId: z.string().trim().min(1).optional(),
    nextName: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(8000).optional(),
    brief: z.string().trim().max(8000).optional(),
    briefMarkdown: z.string().trim().max(8000).optional(),
    headImageUrl: z.string().trim().max(2048).optional(),
    traits: z.record(z.string(), z.unknown()).optional(),
    behavior: z.string().trim().max(8000).optional(),
    style: z.string().trim().max(8000).optional(),
    personality: z.string().trim().max(8000).optional(),
    goals: z.string().trim().max(8000).optional(),
    notes: z.string().trim().max(8000).optional(),
  })
  .refine((value) => Boolean(value.characterNodeId), {
    message: 'Provide characterNodeId to identify which node to update.',
    path: ['characterNodeId'],
  });

const styleTextSchema = z.string().trim().max(8000);

const styleExtrasSchema = z.record(z.string(), z.unknown());

const stylePatchSchema = z.object({
  writingStyle: styleTextSchema.optional(),
  characterStyle: styleTextSchema.optional(),
  artStyle: styleTextSchema.optional(),
  storytellingPacing: styleTextSchema.optional(),
  extras: styleExtrasSchema.optional(),
  styleName: z.string().trim().min(1).max(120).optional(),
  replace: z.boolean().optional(),
  // Legacy fields for backward compatibility with existing prompts/tool usage.
  description: styleTextSchema.optional(),
  style: styleTextSchema.optional(),
  name: z.string().trim().min(1).max(120).optional(),
});

const styleRefineSchema = stylePatchSchema.extend({
  request: z.string().trim().min(1).max(12000),
});

const storyboardToolArgsSchema = z.object({
  storyboardNodeId: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1).max(240).optional(),
  shots: z.array(z.unknown()).optional(),
  frameCount: z.coerce.number().int().min(1).max(24).optional(),
  autoGenerate: z.boolean().optional(),
  createIfMissing: z.boolean().optional(),
});

const storyboardFrameCharacterSchema = z.object({
  characterName: z.string().trim().min(1).max(120),
  action: z.string().trim().min(1).max(1200),
  designCue: z.string().trim().max(1200).default(''),
});

const storyboardFrameSchema = z.object({
  frameNumber: z.coerce.number().int().min(1),
  description: z.string().trim().min(1).max(8000),
  cameraAngle: z.string().trim().max(300).default(''),
  cameraMovement: z.string().trim().max(400).default(''),
  characters: z.array(storyboardFrameCharacterSchema).max(20).default([]),
  durationSeconds: z.coerce.number().min(0.1).max(120).default(3),
  annotations: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
  imageStatus: z.enum(['pending', 'ready', 'failed']).optional(),
  imageUrl: z.string().trim().max(2048).optional(),
});

const storyboardFramesPayloadSchema = z.object({
  frames: z.array(storyboardFrameSchema).min(1).max(24),
});

const generatedStylePayloadSchema = z.object({
  writingStyle: styleTextSchema,
  characterStyle: styleTextSchema,
  artStyle: styleTextSchema,
  storytellingPacing: styleTextSchema,
  extras: z.record(z.string(), z.string()).optional(),
});

const STYLE_DEFAULT_POSITION = {
  x: 980,
  y: 120,
} as const;

const CHARACTER_DESIGN_PUBLIC_DIR = path.join(
  process.cwd(),
  'public',
  'generated',
  'character-designs',
);
const CHARACTER_DESIGN_PUBLIC_URL_PREFIX = '/generated/character-designs';
const CHARACTER_DESIGN_PUBLIC_URL_PREFIX_WITH_SLASH = `${CHARACTER_DESIGN_PUBLIC_URL_PREFIX}/`;

const STORY_DEFAULT_POSITION = {
  x: 80,
  y: 120,
} as const;

const GRID_STEP_Y = 220;
const GRID_MAX_ROWS = 200;

const STORY_NODE_SIZE = { width: 800, height: 420 } as const;
const CHARACTER_NODE_SIZE = { width: 460, height: 520 } as const;
const STYLE_NODE_SIZE = { width: 520, height: 980 } as const;
const STORYBOARD_NODE_SIZE = { width: 420, height: 260 } as const;
const NODE_COLLISION_MARGIN = 16;
const STORYBOARD_DESCRIPTION_STREAM_CHUNK_SIZE = 3;
const STORYBOARD_IMAGE_CHUNK_SIZE = 3;
const STORYBOARD_IMAGE_RETRY_ATTEMPTS = 3;

type NodeRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function intersectsRect(a: NodeRect, b: NodeRect) {
  return !(
    a.x + a.width + NODE_COLLISION_MARGIN <= b.x ||
    b.x + b.width + NODE_COLLISION_MARGIN <= a.x ||
    a.y + a.height + NODE_COLLISION_MARGIN <= b.y ||
    b.y + b.height + NODE_COLLISION_MARGIN <= a.y
  );
}

function buildRect(input: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  return {
    x: input.x,
    y: input.y,
    width: input.width,
    height: input.height,
  } satisfies NodeRect;
}

async function getOccupiedNodeRects(
  projectId: string,
  options?: { ignoreStyleNodeId?: string },
) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      story: {
        select: {
          positionX: true,
          positionY: true,
        },
      },
      characterNodes: {
        orderBy: {
          createdAt: 'asc',
        },
        select: {
          positionX: true,
          positionY: true,
        },
      },
      styleNodes: {
        orderBy: {
          createdAt: 'asc',
        },
        select: {
          id: true,
          positionX: true,
          positionY: true,
        },
      },
      storyboardNodes: {
        orderBy: {
          createdAt: 'asc',
        },
        select: {
          positionX: true,
          positionY: true,
        },
      },
    },
  });

  const occupied: NodeRect[] = [];

  const reserve = (input: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => {
    const { x, y, width, height } = input;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return;
    }

    occupied.push(buildRect({ x, y, width, height }));
  };

  if (project?.story) {
    reserve({
      x: project.story.positionX ?? STORY_DEFAULT_POSITION.x,
      y: project.story.positionY ?? STORY_DEFAULT_POSITION.y,
      width: STORY_NODE_SIZE.width,
      height: STORY_NODE_SIZE.height,
    });
  }

  for (const [index, node] of (project?.characterNodes ?? []).entries()) {
    reserve({
      x: node.positionX ?? 640,
      y: node.positionY ?? 120 + index * 440,
      width: CHARACTER_NODE_SIZE.width,
      height: CHARACTER_NODE_SIZE.height,
    });
  }

  for (const [index, node] of (project?.styleNodes ?? []).entries()) {
    if (options?.ignoreStyleNodeId && node.id === options.ignoreStyleNodeId) {
      continue;
    }

    reserve({
      x: node.positionX ?? STYLE_DEFAULT_POSITION.x,
      y: node.positionY ?? STYLE_DEFAULT_POSITION.y + index * 190,
      width: STYLE_NODE_SIZE.width,
      height: STYLE_NODE_SIZE.height,
    });
  }

  for (const [index, node] of (project?.storyboardNodes ?? []).entries()) {
    reserve({
      x: node.positionX ?? 1320,
      y: node.positionY ?? 120 + index * 190,
      width: STORYBOARD_NODE_SIZE.width,
      height: STORYBOARD_NODE_SIZE.height,
    });
  }

  return occupied;
}

async function resolvePreferredStylePosition(
  projectId: string,
  options?: { ignoreStyleNodeId?: string },
) {
  const occupied = await getOccupiedNodeRects(projectId, options);

  for (let row = 0; row < GRID_MAX_ROWS; row += 1) {
    const candidate = {
      x: STYLE_DEFAULT_POSITION.x,
      y: STYLE_DEFAULT_POSITION.y + row * GRID_STEP_Y,
    };

    const candidateRect = buildRect({
      x: candidate.x,
      y: candidate.y,
      width: STYLE_NODE_SIZE.width,
      height: STYLE_NODE_SIZE.height,
    });

    if (!occupied.some((rect) => intersectsRect(candidateRect, rect))) {
      return candidate;
    }
  }

  const [fallback] = await allocateNodePositions(projectId, 1);
  return fallback ?? STYLE_DEFAULT_POSITION;
}

function getGoogleGenAIOptions(): GoogleGenAIOptions {
  if (env.GEMINI_PROVIDER === 'vertex') {
    return {
      vertexai: true,
      project: env.GOOGLE_CLOUD_PROJECT,
      location: env.GOOGLE_CLOUD_LOCATION,
    };
  }

  return {
    vertexai: false,
    apiKey: env.GEMINI_API_KEY,
  };
}

const characterDerivationAi = new GoogleGenAI(getGoogleGenAIOptions());

type CharacterDesignStatusPhase = 'started' | 'completed';

function emitRuntimeEvent(context: ToolContext, event: AgentToolRuntimeEvent) {
  context.emitEvent?.(event);
}

function emitCharacterDesignStatusEvent(input: {
  context: ToolContext;
  phase: CharacterDesignStatusPhase;
  message: string;
  projectId: string;
  mode: 'single' | 'all';
  characterNodeIds: string[];
  characterNames: string[];
  successCount?: number;
  failedCount?: number;
  sourceTool?: string;
}) {
  emitRuntimeEvent(input.context, {
    type: 'agent.status',
    payload: {
      phase: input.phase,
      message: input.message,
      projectId: input.projectId,
      mode: input.mode,
      characterNodeIds: input.characterNodeIds,
      characterNames: input.characterNames,
      ...(typeof input.successCount === 'number'
        ? { successCount: input.successCount }
        : {}),
      ...(typeof input.failedCount === 'number'
        ? { failedCount: input.failedCount }
        : {}),
      sourceTool: input.sourceTool ?? 'generate_character_design',
    },
  });
}

async function verifyProjectAccess(context: ToolContext) {
  if (!context.projectId) {
    return {
      ok: false as const,
      message:
        'This tool requires an active project. Set project context first.',
    };
  }

  const project = await prisma.project.findFirst({
    where: {
      id: context.projectId,
      userId: context.userId,
    },
    select: {
      id: true,
    },
  });

  if (!project) {
    return {
      ok: false as const,
      message: 'Active project was not found for this user.',
    };
  }

  return {
    ok: true as const,
  };
}

function normalizeDefaultTabType(raw: unknown): 'markdown' | 'google_docs' {
  const normalized = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return normalized === 'google_docs' ? 'google_docs' : 'markdown';
}

function normalizeOptionalTrimmedString(raw: unknown) {
  if (typeof raw !== 'string') {
    return '';
  }

  return raw.trim();
}

function normalizeStringValue(raw: unknown) {
  if (typeof raw !== 'string') {
    return '';
  }

  return raw.trim();
}

function stringifyUnknownValue(raw: unknown) {
  if (raw == null) {
    return '';
  }

  if (
    typeof raw === 'string' ||
    typeof raw === 'number' ||
    typeof raw === 'boolean'
  ) {
    return String(raw).trim();
  }

  try {
    return JSON.stringify(raw);
  } catch {
    return '';
  }
}

function formatValidationIssues(issues: z.ZodIssue[]) {
  return issues.map((issue) => {
    const path = issue.path.length ? issue.path.join('.') : 'input';
    return `${path}: ${issue.message}`;
  });
}

function parseCharacterProfileRecord(raw: string | null | undefined) {
  if (!raw) {
    return {} as CharacterProfilePayload;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {} as CharacterProfilePayload;
    }

    return parsed as CharacterProfilePayload;
  } catch {
    return {} as CharacterProfilePayload;
  }
}

function normalizeCharacterDesignOptions(raw: unknown) {
  if (!Array.isArray(raw)) {
    return [] as CharacterDesignOption[];
  }

  const normalized: CharacterDesignOption[] = [];

  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const record = item as Record<string, unknown>;
    const id = normalizeStringValue(record.id);
    const imageUrl =
      normalizeStringValue(record.imageUrl) ||
      normalizeStringValue(record.imageDataUrl);
    const prompt = normalizeStringValue(record.prompt);
    const createdAt = normalizeStringValue(record.createdAt);

    if (!id || !imageUrl) {
      continue;
    }

    normalized.push({
      id,
      imageUrl,
      prompt,
      createdAt: createdAt || new Date().toISOString(),
    });
  }

  return normalized;
}

function toImageExtension(mimeType?: string) {
  const normalizedMimeType = normalizeStringValue(mimeType).toLowerCase();
  if (
    normalizedMimeType === 'image/jpeg' ||
    normalizedMimeType === 'image/jpg'
  ) {
    return 'jpg';
  }

  if (normalizedMimeType === 'image/webp') {
    return 'webp';
  }

  return 'png';
}

function toMimeTypeFromPath(filePathOrUrl: string) {
  const normalized = filePathOrUrl.trim().toLowerCase();
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) {
    return 'image/jpeg';
  }

  if (normalized.endsWith('.webp')) {
    return 'image/webp';
  }

  return 'image/png';
}

function toCharacterDesignAbsoluteFilePath(imageUrl: string) {
  const normalized = normalizeStringValue(imageUrl);
  if (!normalized.startsWith(CHARACTER_DESIGN_PUBLIC_URL_PREFIX_WITH_SLASH)) {
    return null;
  }

  const relative = normalized.slice(
    CHARACTER_DESIGN_PUBLIC_URL_PREFIX_WITH_SLASH.length,
  );
  if (!relative || relative.includes('..') || path.isAbsolute(relative)) {
    return null;
  }

  return path.join(CHARACTER_DESIGN_PUBLIC_DIR, relative);
}

async function buildStoryboardReferenceImageParts(input: {
  references: StoryboardCharacterDesignReference[];
  frameCharacterNames: Set<string>;
}) {
  const seenUrls = new Set<string>();

  const prioritized =
    input.frameCharacterNames.size > 0
      ? input.references.filter((reference) =>
          input.frameCharacterNames.has(
            reference.characterName.trim().toLowerCase(),
          ),
        )
      : input.references;

  const orderedReferences =
    prioritized.length > 0 ? prioritized : input.references;

  const queued: Array<{
    characterName: string;
    designId: string;
    designPrompt: string;
    imageUrl: string;
  }> = [];

  for (const reference of orderedReferences) {
    const selectedFirst = reference.selectedDesignId
      ? reference.allDesigns.find(
          (item) => item.id === reference.selectedDesignId,
        )
      : null;

    const sequence = [
      ...(selectedFirst ? [selectedFirst] : []),
      ...reference.allDesigns.filter((item) => item.id !== selectedFirst?.id),
    ];

    for (const design of sequence) {
      const imageUrl = normalizeStringValue(design.imageUrl);
      if (!imageUrl || seenUrls.has(imageUrl)) {
        continue;
      }

      seenUrls.add(imageUrl);
      queued.push({
        characterName: reference.characterName,
        designId: normalizeStringValue(design.id) || 'unknown-design',
        designPrompt: normalizeStringValue(design.prompt),
        imageUrl,
      });

      if (queued.length >= 10) {
        break;
      }
    }

    if (queued.length >= 10) {
      break;
    }
  }

  const loaded = await Promise.all(
    queued.map(async (item, index) => {
      const absolutePath = toCharacterDesignAbsoluteFilePath(item.imageUrl);
      if (!absolutePath) {
        return null;
      }

      try {
        const bytes = await readFile(absolutePath);
        return {
          tag: `REF_${String(index + 1).padStart(2, '0')}`,
          characterName: item.characterName,
          designId: item.designId,
          designPrompt: item.designPrompt,
          imageUrl: item.imageUrl,
          inlineData: {
            data: bytes.toString('base64'),
            mimeType: toMimeTypeFromPath(item.imageUrl),
          },
        } satisfies StoryboardAttachedReferenceImage;
      } catch {
        return null;
      }
    }),
  );

  return loaded.filter((item): item is StoryboardAttachedReferenceImage =>
    Boolean(item?.inlineData?.data),
  );
}

async function saveCharacterDesignImageToPublicFolder(input: {
  imageBytesBase64: string;
  mimeType?: string;
}) {
  await mkdir(CHARACTER_DESIGN_PUBLIC_DIR, { recursive: true });

  const extension = toImageExtension(input.mimeType);
  const fileName = `design-${Date.now()}-${randomUUID()}.${extension}`;
  const absoluteFilePath = path.join(CHARACTER_DESIGN_PUBLIC_DIR, fileName);
  const binary = Buffer.from(input.imageBytesBase64, 'base64');

  await writeFile(absoluteFilePath, binary);

  return `${CHARACTER_DESIGN_PUBLIC_URL_PREFIX}/${fileName}`;
}

function buildCharacterDesignPrompt(input: {
  characterName: string;
  briefMarkdown: string;
  profile: CharacterProfilePayload;
  style: ProjectStylePayload;
}) {
  const characterSummary = [
    input.profile.description,
    input.profile.behavior,
    input.profile.style,
    input.profile.personality,
    input.profile.goals,
    input.profile.notes,
  ]
    .filter((value) => typeof value === 'string' && value.trim())
    .join('\n');

  return [
    `Production character design sheet for ${input.characterName}.`,
    'Output one complete character design sheet image (not a single portrait).',
    'The sheet must include all of these sections clearly in one composition:',
    '1) Full-body turnaround views: front, 3/4 front, side, 3/4 back, and back.',
    '2) Expression/emotion variants: neutral, happy, angry, sad, surprised, determined.',
    '3) Color palette swatches with labeled primary/secondary/accent colors and skin/hair/eye tones.',
    '4) Costume and prop callouts with small detail insets.',
    '5) Silhouette readability and proportions guide.',
    'Render as clean concept art sheet with clear spacing, legible labels, and consistent style.',
    'Avoid heavy background scenery; keep sheet-focused presentation on a clean studio backdrop.',
    'Keep the same character identity across all views and variants.',
    '',
    'Character brief:',
    characterSummary || input.briefMarkdown || 'No additional brief provided.',
    '',
    'Project style guide:',
    `Writing style: ${input.style.writingStyle || 'Not specified.'}`,
    `Character style: ${input.style.characterStyle || 'Not specified.'}`,
    `Art style: ${input.style.artStyle || 'Not specified.'}`,
    `Storytelling pacing: ${input.style.storytellingPacing || 'Not specified.'}`,
    `Additional style dimensions: ${
      Object.entries(input.style.extras)
        .map(([key, value]) => `${key}: ${value}`)
        .join('; ') || 'None.'
    }`,
  ].join('\n');
}

async function generateCharacterDesignOptions(input: {
  prompt: string;
  optionsCount: number;
}) {
  const response = await characterDerivationAi.models.generateImages({
    model: env.GEMINI_CHARACTER_DESIGN_IMAGE_MODEL,
    prompt: input.prompt,
    config: {
      numberOfImages: input.optionsCount,
      aspectRatio: '1:1',
      outputMimeType: 'image/png',
    },
  });

  const generated = response.generatedImages ?? [];
  const nowIso = new Date().toISOString();

  const persistedOptions = await Promise.all(
    generated.map(async (item, index) => {
      const imageBytes = normalizeStringValue(item.image?.imageBytes);
      if (!imageBytes) {
        return null;
      }

      const imageUrl = await saveCharacterDesignImageToPublicFolder({
        imageBytesBase64: imageBytes,
        mimeType: item.image?.mimeType,
      });

      return {
        id: `design-${Date.now()}-${index}`,
        imageUrl,
        prompt: input.prompt,
        createdAt: nowIso,
      } satisfies CharacterDesignOption;
    }),
  );

  return persistedOptions.filter((item): item is CharacterDesignOption =>
    Boolean(item),
  );
}

function mergeCharacterDesignOptions(input: {
  current: CharacterDesignOption[];
  generated: CharacterDesignOption[];
  replaceExisting: boolean;
}) {
  if (input.replaceExisting) {
    return input.generated;
  }

  return [...input.current, ...input.generated];
}

function parseCharacterDraft(raw: unknown): CharacterDraftInput | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const name = normalizeStringValue(record.name);
  if (!name) {
    return null;
  }

  const traits =
    record.traits && typeof record.traits === 'object'
      ? (record.traits as Record<string, unknown>)
      : {};

  const description = normalizeStringValue(record.description || record.brief);
  const headImageUrl = normalizeStringValue(record.headImageUrl);
  const behavior = normalizeStringValue(
    record.behavior || traits.behavior || traits.behaviour,
  );
  const style = normalizeStringValue(record.style || traits.style);
  const personality = normalizeStringValue(
    record.personality || traits.personality,
  );
  const goals = normalizeStringValue(record.goals || traits.goals);
  const notes = normalizeStringValue(record.notes || traits.notes);

  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    const normalizedKey = key.trim();
    if (!normalizedKey || CHARACTER_CANONICAL_KEYS.has(normalizedKey)) {
      continue;
    }

    const normalizedValue = stringifyUnknownValue(value);
    if (!normalizedValue) {
      continue;
    }

    attributes[normalizedKey] = normalizedValue;
  }

  for (const [key, value] of Object.entries(traits)) {
    const normalizedKey = key.trim();
    if (!normalizedKey || CHARACTER_CANONICAL_KEYS.has(normalizedKey)) {
      continue;
    }

    const normalizedValue = stringifyUnknownValue(value);
    if (!normalizedValue) {
      continue;
    }

    attributes[normalizedKey] = normalizedValue;
  }

  const profile: CharacterProfilePayload = {
    ...(description ? { description } : {}),
    ...(headImageUrl ? { headImageUrl } : {}),
    ...(behavior ? { behavior } : {}),
    ...(style ? { style } : {}),
    ...(personality ? { personality } : {}),
    ...(goals ? { goals } : {}),
    ...(notes ? { notes } : {}),
    ...(Object.keys(attributes).length ? { attributes } : {}),
  };

  return {
    name,
    description,
    profile,
  };
}

function buildCharacterBriefMarkdown(input: CharacterDraftInput) {
  const lines: string[] = [];

  if (input.description) {
    lines.push(input.description);
  }

  const traitLines = [
    ['Behavior', input.profile.behavior],
    ['Style', input.profile.style],
    ['Personality', input.profile.personality],
    ['Goals', input.profile.goals],
    ['Notes', input.profile.notes],
  ]
    .filter(([, value]) => Boolean(value))
    .map(([label, value]) => `- **${label}:** ${value}`);

  if (traitLines.length) {
    if (lines.length) {
      lines.push('');
    }
    lines.push(...traitLines);
  }

  if (!lines.length) {
    lines.push('Character brief generated from story context.');
  }

  return lines.join('\n');
}

const CHARACTER_NAME_STOPWORDS = new Set([
  'He',
  'She',
  'They',
  'Them',
  'Him',
  'Her',
  'His',
  'Hers',
  'Their',
  'Theirs',
  'Its',
  'It',
  'One',
  'The',
  'This',
  'That',
  'Those',
  'These',
  'A',
  'An',
  'And',
  'But',
  'Or',
  'For',
  'With',
  'Without',
  'In',
  'On',
  'At',
  'By',
  'From',
  'To',
  'Of',
  'As',
  'If',
  'When',
  'Then',
  'Meanwhile',
  'Chapter',
  'Scene',
  'Story',
  'Act',
  'Episode',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
  'Clear',
  'Instead',
  'Just',
  'More',
  'Less',
  'Only',
  'First',
  'Second',
  'Third',
  'Finally',
  'Suddenly',
  'However',
  'Therefore',
  'Because',
]);

function sanitizeStoryMarkdown(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/[>#*_~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function looksLikeActingCharacter(markdown: string, candidate: string) {
  const candidateLower = candidate.toLowerCase();
  if (NON_CHARACTER_ENTITY_WORDS.has(candidateLower)) {
    return false;
  }

  const sentences = markdown
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const candidateRegex = new RegExp(`\\b${escapeRegExp(candidate)}\\b`, 'i');
  const mentionSentences = sentences.filter((sentence) =>
    candidateRegex.test(sentence),
  );

  if (!mentionSentences.length) {
    return false;
  }

  let personEvidence = 0;
  let nonCharacterEvidence = 0;

  const locationPattern = new RegExp(
    `\\b(in|at|from|to|into|onto|inside|outside|near)\\s+${escapeRegExp(candidate)}\\b`,
    'i',
  );

  for (const sentence of mentionSentences) {
    const lower = sentence.toLowerCase();

    if (locationPattern.test(sentence)) {
      nonCharacterEvidence += 2;
    }

    const hasAction = CHARACTER_ACTION_HINTS.some((token) =>
      new RegExp(`\\b${token}\\b`, 'i').test(sentence),
    );
    const hasPronoun = CHARACTER_PRONOUN_HINTS.some((token) =>
      new RegExp(`\\b${token}\\b`, 'i').test(sentence),
    );

    if (hasAction || hasPronoun) {
      personEvidence += 1;
    }

    if (
      NON_CHARACTER_ENTITY_WORDS.size > 0 &&
      [...NON_CHARACTER_ENTITY_WORDS].some(
        (word) =>
          word !== candidateLower &&
          new RegExp(`\\b${escapeRegExp(word)}\\b`).test(lower),
      )
    ) {
      nonCharacterEvidence += 1;
    }
  }

  return personEvidence > 0 && personEvidence >= nonCharacterEvidence;
}

function extractCharacterNameCandidates(
  markdown: string,
  maxCharacters: number,
) {
  const cleaned = sanitizeStoryMarkdown(markdown);
  if (!cleaned) {
    return [];
  }

  const matches = cleaned.matchAll(
    /\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){0,2}\b/g,
  );

  const counters = new Map<string, { total: number; nonBoundary: number }>();

  const isBoundaryMatch = (start: number) => {
    if (start <= 0) {
      return true;
    }

    const prefix = cleaned.slice(0, start);
    const punctuationIndex = Math.max(
      prefix.lastIndexOf('.'),
      prefix.lastIndexOf('!'),
      prefix.lastIndexOf('?'),
      prefix.lastIndexOf('\n'),
    );

    const gap = prefix.slice(punctuationIndex + 1);
    return gap.trim() === '';
  };

  for (const match of matches) {
    const candidate = (match[0] ?? '').trim().replace(/\s+/g, ' ');
    if (!candidate) {
      continue;
    }

    const parts = candidate.split(' ');
    if (parts.every((part) => CHARACTER_NAME_STOPWORDS.has(part))) {
      continue;
    }

    if (parts.length === 1 && CHARACTER_NAME_STOPWORDS.has(parts[0])) {
      continue;
    }

    const key = candidate.toLowerCase();
    const stats = counters.get(key) ?? { total: 0, nonBoundary: 0 };
    stats.total += 1;

    const start = match.index ?? -1;
    if (start >= 0 && !isBoundaryMatch(start)) {
      stats.nonBoundary += 1;
    }

    counters.set(key, stats);
  }

  const ranked = [...counters.entries()]
    .filter(([name, stats]) => {
      const isMultiWord = name.includes(' ');
      if (isMultiWord) {
        return stats.total >= 1 && looksLikeActingCharacter(markdown, name);
      }

      return (
        (stats.nonBoundary >= 1 || stats.total >= 2) &&
        looksLikeActingCharacter(markdown, name)
      );
    })
    .sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]))
    .slice(0, maxCharacters)
    .map(([key]) =>
      key
        .split(' ')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' '),
    );

  return ranked;
}

function summarizeCharacterFromStory(markdown: string, characterName: string) {
  const sentences = markdown
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const matching = sentences
    .filter((sentence) =>
      new RegExp(
        `\\b${characterName.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`,
        'i',
      ).test(sentence),
    )
    .slice(0, 2);

  if (!matching.length) {
    return 'Core character inferred from active story context.';
  }

  return matching.join(' ');
}

function deriveCharacterDraftsFromStoryHeuristic(input: {
  storyTitle: string;
  markdown: string;
  maxCharacters: number;
}) {
  const names = extractCharacterNameCandidates(
    input.markdown,
    input.maxCharacters,
  );
  return names.map((name) => {
    const summary = summarizeCharacterFromStory(input.markdown, name);
    return {
      name,
      description: `Auto-generated from story node "${input.storyTitle}".`,
      profile: {
        notes: summary,
      },
    } satisfies CharacterDraftInput;
  });
}

function extractJsonText(rawText: string) {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return '';
  }

  if (!trimmed.startsWith('```')) {
    return trimmed;
  }

  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function getGenerateContentText(response: unknown) {
  if (!response || typeof response !== 'object') {
    return '';
  }

  const record = response as Record<string, unknown>;
  const directText = record.text;

  if (typeof directText === 'string') {
    return directText;
  }

  if (typeof directText === 'function') {
    try {
      const value = directText();
      return typeof value === 'string' ? value : '';
    } catch {
      return '';
    }
  }

  return '';
}

function normalizeStoryboardFrame(
  raw: unknown,
  fallbackFrameNumber: number,
): StoryboardFrame | null {
  const parsed = storyboardFrameSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }

  const frame = parsed.data;
  return {
    frameNumber:
      Number.isFinite(frame.frameNumber) && frame.frameNumber > 0
        ? Math.trunc(frame.frameNumber)
        : fallbackFrameNumber,
    description: frame.description,
    cameraAngle: frame.cameraAngle,
    cameraMovement: frame.cameraMovement,
    characters: frame.characters.map((item) => ({
      characterName: item.characterName,
      action: item.action,
      designCue: item.designCue,
    })),
    durationSeconds: frame.durationSeconds,
    annotations: frame.annotations,
    ...(frame.imageStatus ? { imageStatus: frame.imageStatus } : {}),
    ...(frame.imageUrl ? { imageUrl: frame.imageUrl } : {}),
  };
}

function normalizeStoryboardFramesFromUnknown(raw: unknown) {
  if (!Array.isArray(raw)) {
    return [] as StoryboardFrame[];
  }

  const frames = raw
    .map((item, index) => normalizeStoryboardFrame(item, index + 1))
    .filter((item): item is StoryboardFrame => Boolean(item))
    .slice(0, 24)
    .map((frame, index) => ({
      ...frame,
      frameNumber: index + 1,
    }));

  return frames;
}

function collectStoryboardCharacterDesignReferences(
  characterNodes: Array<{
    name: string;
    briefMarkdown?: string | null;
    profileJson?: string | null;
  }>,
) {
  return characterNodes.map((character) => {
    const profile = parseCharacterProfileRecord(character.profileJson);
    const allDesigns = normalizeCharacterDesignOptions(
      profile.characterDesigns,
    );
    const selectedDesignId = normalizeStringValue(
      profile.selectedCharacterDesignId,
    );
    const selectedDesign = allDesigns.find(
      (item) => item.id === selectedDesignId,
    );

    return {
      characterName: character.name,
      briefMarkdown: normalizeStringValue(character.briefMarkdown),
      description: normalizeStringValue(profile.description),
      profileStyle: normalizeStringValue(profile.style),
      profileBehavior: normalizeStringValue(profile.behavior),
      selectedDesignId,
      selectedDesignPrompt:
        normalizeStringValue(selectedDesign?.prompt) ||
        normalizeStringValue(profile.characterDesignPrompt),
      allDesigns,
    } satisfies StoryboardCharacterDesignReference;
  });
}

function buildStoryboardGenerationPrompt(input: {
  storyTitle: string;
  storyMarkdown: string;
  frameCountHint?: number;
  style: ProjectStylePayload;
  characters: Array<{
    name: string;
    briefMarkdown: string;
    description: string;
    designCue: string;
  }>;
}) {
  const characterSection = input.characters.length
    ? input.characters
        .map(
          (character) =>
            `- ${character.name}\n  - Description: ${character.description || 'N/A'}\n  - Design cue: ${character.designCue || 'N/A'}\n  - Brief: ${character.briefMarkdown || 'N/A'}`,
        )
        .join('\n')
    : '- No character nodes found. Use story actors only if explicit in text.';

  return [
    'You are a storyboard director AI.',
    'Create a simple storyboard list with strong actionable frame descriptions.',
    'Use story context + project style guide + character design cues.',
    'Return JSON only and do not wrap in markdown fences.',
    'Output schema:',
    '{"frames":[{"frameNumber":1,"description":"...","cameraAngle":"...","cameraMovement":"...","characters":[{"characterName":"...","action":"...","designCue":"..."}],"durationSeconds":3,"annotations":["..."],"imageUrl":""}]}',
    'Rules:',
    '1) Create a coherent sequence covering beginning/middle/end beats.',
    '2) Descriptions must be detailed and visual, including framing intent.',
    '3) Include camera angle and movement for each frame.',
    '4) Include characters with explicit actions and design cues.',
    '5) Include concise annotation tags for action clarity (e.g. "Action:...", "Emotion:...", "Transition:...").',
    '6) Keep frame language production-friendly and specific.',
    '7) Keep duration in seconds, usually between 1 and 8.',
    '8) Keep total frame count appropriate to pacing and scope.',
    ...(input.frameCountHint
      ? [
          `9) Target approximately ${input.frameCountHint} frames while preserving pacing quality.`,
        ]
      : []),
    '',
    `Story title: ${input.storyTitle}`,
    'Story markdown:',
    input.storyMarkdown,
    '',
    'Project style guide:',
    `- Writing style: ${input.style.writingStyle || 'Not specified'}`,
    `- Character style: ${input.style.characterStyle || 'Not specified'}`,
    `- Art style: ${input.style.artStyle || 'Not specified'}`,
    `- Storytelling pacing: ${input.style.storytellingPacing || 'Not specified'}`,
    `- Extras: ${JSON.stringify(input.style.extras)}`,
    '',
    'Character references:',
    characterSection,
  ].join('\n');
}

async function deriveStoryboardFramesWithSubAgent(input: {
  storyTitle: string;
  storyMarkdown: string;
  frameCountHint?: number;
  style: ProjectStylePayload;
  characters: Array<{
    name: string;
    briefMarkdown: string;
    description: string;
    designCue: string;
  }>;
}) {
  const prompt = buildStoryboardGenerationPrompt(input);

  const response = await characterDerivationAi.models.generateContent({
    model: env.GEMINI_STORYBOARD_SUBAGENT_MODEL,
    contents: prompt,
    config: {
      temperature: 0.3,
      responseMimeType: 'application/json',
    },
  });

  const text = extractJsonText(getGenerateContentText(response));
  if (!text) {
    return [] as StoryboardFrame[];
  }

  const parsedUnknown = JSON.parse(text);
  const parsed = storyboardFramesPayloadSchema.safeParse(parsedUnknown);
  if (parsed.success) {
    return parsed.data.frames.map((frame, index) => ({
      frameNumber: index + 1,
      description: frame.description,
      cameraAngle: frame.cameraAngle,
      cameraMovement: frame.cameraMovement,
      characters: frame.characters.map((item) => ({
        characterName: item.characterName,
        action: item.action,
        designCue: item.designCue,
      })),
      durationSeconds: frame.durationSeconds,
      annotations: frame.annotations,
      ...(frame.imageUrl ? { imageUrl: frame.imageUrl } : {}),
    }));
  }

  // Fallback parser in case model returns array directly instead of {frames:[...]}
  const rawFrames = Array.isArray(parsedUnknown)
    ? parsedUnknown
    : (parsedUnknown as Record<string, unknown>)?.frames;
  return normalizeStoryboardFramesFromUnknown(rawFrames);
}

function buildStoryboardFrameImagePrompt(input: {
  storyTitle: string;
  frame: StoryboardFrame;
  style: ProjectStylePayload;
  characterDesignReferences: StoryboardCharacterDesignReference[];
  attachedReferenceImages: StoryboardAttachedReferenceImage[];
}) {
  const characters = input.frame.characters.length
    ? input.frame.characters
        .map(
          (character) =>
            `- ${character.characterName}: action=${character.action}; designCue=${character.designCue || 'N/A'}`,
        )
        .join('\n')
    : '- No explicit characters for this frame.';

  const frameCharacterNames = new Set(
    input.frame.characters
      .map((item) => item.characterName.trim().toLowerCase())
      .filter(Boolean),
  );

  const prioritizedCharacterReferences =
    frameCharacterNames.size > 0
      ? input.characterDesignReferences.filter((reference) =>
          frameCharacterNames.has(reference.characterName.trim().toLowerCase()),
        )
      : input.characterDesignReferences;

  const characterReferences = (
    prioritizedCharacterReferences.length
      ? prioritizedCharacterReferences
      : input.characterDesignReferences
  )
    .map((reference) => {
      const designLines = reference.allDesigns.length
        ? reference.allDesigns
            .map(
              (design, index) =>
                `    ${index + 1}) id=${design.id}; designPrompt=${design.prompt || 'N/A'}`,
            )
            .join('\n')
        : '    No generated design options available yet.';

      return [
        `- ${reference.characterName}`,
        `  - Description: ${reference.description || 'N/A'}`,
        `  - Brief: ${reference.briefMarkdown || 'N/A'}`,
        `  - Profile style cue: ${reference.profileStyle || 'N/A'}`,
        `  - Profile behavior cue: ${reference.profileBehavior || 'N/A'}`,
        `  - Selected design id: ${reference.selectedDesignId || 'N/A'}`,
        `  - Selected design prompt: ${reference.selectedDesignPrompt || 'N/A'}`,
        '  - All design options:',
        designLines,
      ].join('\n');
    })
    .join('\n');

  const attachedReferenceLines = input.attachedReferenceImages.length
    ? input.attachedReferenceImages
        .map(
          (item) =>
            `- [${item.tag}] character=${item.characterName}; designId=${item.designId}; designPrompt=${item.designPrompt || 'N/A'}`,
        )
        .join('\n')
    : '- No reference images were attached.';

  return [
    'Create one storyboard frame image as clean pre-production sketch art.',
    'HARD REQUIREMENT: preserve character identity and visual consistency from character design references.',
    'HARD REQUIREMENT: apply project art style directly to composition, lighting, palette, and texture treatment.',
    'Keep it simple, readable, and annotation-friendly.',
    'No heavy rendering, no photoreal output. Prioritize composition clarity.',
    `Story: ${input.storyTitle}`,
    `Frame description: ${input.frame.description}`,
    `Camera angle: ${input.frame.cameraAngle || 'Not specified'}`,
    `Camera movement: ${input.frame.cameraMovement || 'Static'}`,
    `Frame annotations: ${input.frame.annotations.join('; ') || 'None'}`,
    'Frame characters:',
    characters,
    '',
    'Character design references (use for visual consistency):',
    characterReferences || '- No character design references available.',
    '',
    'Attached reference images (authoritative mapping):',
    attachedReferenceLines,
    '',
    'Execution rules:',
    '1) For each named frame character, use attached image references by [REF_xx] tag as the primary source of visual truth.',
    '2) Keep stable silhouette, outfit motifs, hairstyle, and color accents across frames.',
    '3) If frame character names are missing, infer cast from description but still anchor to provided design references.',
    '4) Do not ignore project art style; enforce it in lens language, lighting model, palette, and surface rendering.',
    '5) Avoid introducing new character costume/hair changes unless explicitly requested in frame description.',
    '',
    'Project style guide:',
    `- Character style: ${input.style.characterStyle || 'Not specified'}`,
    `- Art style: ${input.style.artStyle || 'Not specified'}`,
    `- Storytelling pacing: ${input.style.storytellingPacing || 'Not specified'}`,
  ].join('\n');
}

async function generateStoryboardFrameImage(input: {
  storyTitle: string;
  frame: StoryboardFrame;
  style: ProjectStylePayload;
  characterDesignReferences: StoryboardCharacterDesignReference[];
}) {
  const frameCharacterNames = new Set(
    input.frame.characters
      .map((item) => item.characterName.trim().toLowerCase())
      .filter(Boolean),
  );

  const modelName = normalizeStringValue(env.GEMINI_STORYBOARD_IMAGE_MODEL);
  const useGeminiImageModel = /gemini/i.test(modelName);

  if (useGeminiImageModel) {
    const attachedReferenceImages = await buildStoryboardReferenceImageParts({
      references: input.characterDesignReferences,
      frameCharacterNames,
    });

    const prompt = buildStoryboardFrameImagePrompt({
      ...input,
      attachedReferenceImages,
    });

    const multimodalContents: Array<
      | string
      | { text: string }
      | { inlineData: { data: string; mimeType: string } }
    > = [];

    for (const reference of attachedReferenceImages) {
      multimodalContents.push({
        text: `[${reference.tag}] Character: ${reference.characterName}; designId: ${reference.designId}; designPrompt: ${reference.designPrompt || 'N/A'}`,
      });
      multimodalContents.push({
        inlineData: reference.inlineData,
      });
    }

    multimodalContents.push(prompt);

    const response = await characterDerivationAi.models.generateContent({
      model: modelName,
      contents: multimodalContents,
      config: {
        imageConfig: {
          aspectRatio: '16:9',
        },
        // Explicitly request image output when model supports multimodal responses.
        responseModalities: ['IMAGE', 'TEXT'],
      },
    });

    const record = response as unknown as Record<string, unknown>;
    const candidates = Array.isArray(record.candidates)
      ? (record.candidates as Array<Record<string, unknown>>)
      : [];

    for (const candidate of candidates) {
      const content =
        candidate && typeof candidate.content === 'object'
          ? (candidate.content as Record<string, unknown>)
          : null;
      const parts =
        content && Array.isArray(content.parts)
          ? (content.parts as Array<Record<string, unknown>>)
          : [];

      for (const part of parts) {
        const inlineData =
          part && typeof part.inlineData === 'object'
            ? (part.inlineData as Record<string, unknown>)
            : null;
        const imageBytes = normalizeStringValue(inlineData?.data);
        if (!imageBytes) {
          continue;
        }

        return saveCharacterDesignImageToPublicFolder({
          imageBytesBase64: imageBytes,
          mimeType: normalizeStringValue(inlineData?.mimeType) || 'image/png',
        });
      }
    }

    throw new Error('Gemini image model returned no inline image bytes.');
  }

  const prompt = buildStoryboardFrameImagePrompt({
    ...input,
    attachedReferenceImages: [],
  });

  const response = await characterDerivationAi.models.generateImages({
    model: modelName,
    prompt,
    config: {
      numberOfImages: 1,
      aspectRatio: '16:9',
      outputMimeType: 'image/png',
    },
  });

  const image = response.generatedImages?.[0]?.image;
  const imageBytes = normalizeStringValue(image?.imageBytes);
  if (!imageBytes) {
    throw new Error('Image model returned no image bytes for this frame.');
  }

  return saveCharacterDesignImageToPublicFolder({
    imageBytesBase64: imageBytes,
    mimeType: normalizeStringValue(image?.mimeType) || 'image/png',
  });
}

async function generateStoryboardFrameImageWithRetry(input: {
  storyTitle: string;
  frame: StoryboardFrame;
  style: ProjectStylePayload;
  characterDesignReferences: StoryboardCharacterDesignReference[];
  maxAttempts?: number;
}) {
  const maxAttempts = Math.max(
    1,
    input.maxAttempts ?? STORYBOARD_IMAGE_RETRY_ATTEMPTS,
  );
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const imageUrl = await generateStoryboardFrameImage(input);
      return {
        ok: true,
        imageUrl,
        attempts: attempt,
      } as const;
    } catch (error) {
      lastError = error;
    }
  }

  return {
    ok: false,
    attempts: maxAttempts,
    error:
      lastError instanceof Error
        ? lastError.message
        : 'Storyboard image generation failed.',
  } as const;
}

export async function regenerateStoryboardFrameImageForUser(input: {
  userId: string;
  projectId: string;
  storyboardNodeId: string;
  frameNumber: number;
}) {
  const projectGraph = await prisma.project.findFirst({
    where: {
      id: input.projectId,
      userId: input.userId,
    },
    select: {
      id: true,
      story: {
        select: {
          title: true,
        },
      },
      styleNodes: {
        select: {
          writingStyle: true,
          characterStyle: true,
          artStyle: true,
          storytellingPacing: true,
          description: true,
          extrasJson: true,
        },
        take: 1,
      },
      characterNodes: {
        select: {
          name: true,
          briefMarkdown: true,
          profileJson: true,
        },
        orderBy: {
          createdAt: 'asc',
        },
      },
      storyboardNodes: {
        where: {
          id: input.storyboardNodeId,
        },
        select: {
          id: true,
          shotsJson: true,
        },
        take: 1,
      },
    },
  });

  if (!projectGraph) {
    return {
      ok: false,
      message: 'Project not found.',
    } as const;
  }

  const storyboardNode = projectGraph.storyboardNodes[0];
  if (!storyboardNode) {
    return {
      ok: false,
      message: 'Storyboard node not found.',
    } as const;
  }

  const styleNode = projectGraph.styleNodes[0];
  const style = styleNode
    ? toProjectStylePayload(styleNode)
    : {
        writingStyle: '',
        characterStyle: '',
        artStyle: '',
        storytellingPacing: '',
        extras: {},
      };

  const frames = normalizeStoryboardFramesFromUnknown(
    (() => {
      const shotsJson = normalizeStringValue(storyboardNode.shotsJson);
      if (!shotsJson) {
        return [] as unknown[];
      }

      try {
        const parsed = JSON.parse(shotsJson);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [] as unknown[];
      }
    })(),
  );

  const targetIndex = frames.findIndex(
    (frame) => frame.frameNumber === input.frameNumber,
  );
  if (targetIndex < 0) {
    return {
      ok: false,
      message: `Frame ${input.frameNumber} was not found in storyboard.`,
    } as const;
  }

  const frame = frames[targetIndex];
  if (!frame.description.trim()) {
    return {
      ok: false,
      message: 'Cannot generate image for an empty frame description.',
    } as const;
  }

  const result = await generateStoryboardFrameImageWithRetry({
    storyTitle: normalizeStringValue(projectGraph.story?.title) || 'Story',
    frame,
    style,
    characterDesignReferences: collectStoryboardCharacterDesignReferences(
      projectGraph.characterNodes,
    ),
    maxAttempts: STORYBOARD_IMAGE_RETRY_ATTEMPTS,
  });

  const nextFrame: StoryboardFrame = result.ok
    ? {
        ...frame,
        imageUrl: result.imageUrl,
        imageStatus: 'ready',
      }
    : {
        ...frame,
        imageStatus: 'failed',
      };

  const nextFrames = frames.map((item, index) =>
    index === targetIndex ? nextFrame : item,
  );

  const node = await prisma.storyboardNode.update({
    where: {
      id: storyboardNode.id,
    },
    data: {
      shotsJson: JSON.stringify(nextFrames),
    },
  });

  return {
    ok: result.ok,
    node,
    frameNumber: input.frameNumber,
    attempts: result.attempts,
    ...(result.ok ? { imageUrl: result.imageUrl } : { message: result.error }),
  } as const;
}

function normalizeStyleExtras(raw: unknown) {
  if (!raw || typeof raw !== 'object') {
    return {} as Record<string, string>;
  }

  const extras: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const normalizedKey = key.trim();
    const normalizedValue = stringifyUnknownValue(value);
    if (!normalizedKey || !normalizedValue) {
      continue;
    }

    extras[normalizedKey] = normalizedValue;
  }

  return extras;
}

function parseStyleExtrasJson(raw: string | null | undefined) {
  if (!raw) {
    return {} as Record<string, string>;
  }

  try {
    const parsed = JSON.parse(raw);
    return normalizeStyleExtras(parsed);
  } catch {
    return {} as Record<string, string>;
  }
}

function parseLegacyStyleDescription(description: string) {
  const parsed: Partial<ProjectStylePayload> = {};
  const normalized = description
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of normalized) {
    const match = /^([^:]+):\s*(.+)$/.exec(line);
    if (!match) {
      continue;
    }

    const key = match[1].trim().toLowerCase();
    const value = match[2].trim();
    if (!value) {
      continue;
    }

    if (key === 'writing style') {
      parsed.writingStyle = value;
      continue;
    }

    if (key === 'character style') {
      parsed.characterStyle = value;
      continue;
    }

    if (key === 'art style') {
      parsed.artStyle = value;
      continue;
    }

    if (key === 'storytelling pacing') {
      parsed.storytellingPacing = value;
    }
  }

  return parsed;
}

function buildStyleDescription(payload: ProjectStylePayload) {
  const lines: string[] = [
    `Writing Style: ${payload.writingStyle || 'Not specified yet.'}`,
    `Character Style: ${payload.characterStyle || 'Not specified yet.'}`,
    `Art Style: ${payload.artStyle || 'Not specified yet.'}`,
    `Storytelling Pacing: ${payload.storytellingPacing || 'Not specified yet.'}`,
  ];

  const extras = Object.entries(payload.extras);
  if (extras.length) {
    lines.push('');
    lines.push('Additional Style Direction:');
    for (const [key, value] of extras) {
      lines.push(`- ${key}: ${value}`);
    }
  }

  return lines.join('\n');
}

function toProjectStylePayload(node: {
  writingStyle?: string | null;
  characterStyle?: string | null;
  artStyle?: string | null;
  storytellingPacing?: string | null;
  description?: string | null;
  extrasJson?: string | null;
}): ProjectStylePayload {
  const writingStyle = normalizeStringValue(node.writingStyle);
  const characterStyle = normalizeStringValue(node.characterStyle);
  const artStyle = normalizeStringValue(node.artStyle);
  const storytellingPacing = normalizeStringValue(node.storytellingPacing);

  const legacyFallback = normalizeStringValue(node.description);
  const legacyParsed = parseLegacyStyleDescription(legacyFallback);
  const extras = parseStyleExtrasJson(node.extrasJson);

  return {
    writingStyle: writingStyle || legacyParsed.writingStyle || legacyFallback,
    characterStyle: characterStyle || legacyParsed.characterStyle || '',
    artStyle: artStyle || legacyParsed.artStyle || '',
    storytellingPacing:
      storytellingPacing || legacyParsed.storytellingPacing || '',
    extras,
  };
}

function mergeStylePayload(input: {
  current: ProjectStylePayload;
  patch: Partial<ProjectStylePayload>;
  replace: boolean;
}): ProjectStylePayload {
  const next = input.replace
    ? {
        writingStyle: '',
        characterStyle: '',
        artStyle: '',
        storytellingPacing: '',
        extras: {},
      }
    : {
        ...input.current,
        extras: { ...input.current.extras },
      };

  if (typeof input.patch.writingStyle === 'string') {
    next.writingStyle = input.patch.writingStyle.trim();
  }
  if (typeof input.patch.characterStyle === 'string') {
    next.characterStyle = input.patch.characterStyle.trim();
  }
  if (typeof input.patch.artStyle === 'string') {
    next.artStyle = input.patch.artStyle.trim();
  }
  if (typeof input.patch.storytellingPacing === 'string') {
    next.storytellingPacing = input.patch.storytellingPacing.trim();
  }

  if (input.patch.extras) {
    next.extras = input.replace
      ? normalizeStyleExtras(input.patch.extras)
      : {
          ...next.extras,
          ...normalizeStyleExtras(input.patch.extras),
        };
  }

  return next;
}

function inferStylePatchFromRequest(request: string) {
  const normalized = request.trim();
  const lower = normalized.toLowerCase();
  if (!normalized) {
    return {} as Partial<ProjectStylePayload>;
  }

  if (/pacing|rhythm|tempo/.test(lower)) {
    return { storytellingPacing: normalized };
  }

  if (/art|visual|aesthetic|look|palette|cinematic/.test(lower)) {
    return { artStyle: normalized };
  }

  if (/character|persona|dialogue|voice\s+of\s+characters/.test(lower)) {
    return { characterStyle: normalized };
  }

  if (/writing|prose|tone|narration|retouch|rewrite/.test(lower)) {
    return { writingStyle: normalized };
  }

  return {
    extras: {
      LatestDirection: normalized,
    },
  };
}

function isStyleTextUnderSpecified(value: string, request: string) {
  const normalized = value.trim();
  if (!normalized) {
    return true;
  }

  if (normalized.toLowerCase() === request.trim().toLowerCase()) {
    return true;
  }

  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  return wordCount < 10;
}

function buildExpandedStylePatchFromRequest(input: {
  current: ProjectStylePayload;
  request: string;
  candidate: Partial<ProjectStylePayload>;
}) {
  const request = input.request.trim();
  const requestSentence = request.endsWith('.') ? request : `${request}.`;

  const writingSeed =
    input.current.writingStyle ||
    'Clear prose with vivid but disciplined sensory detail.';
  const characterSeed =
    input.current.characterStyle ||
    'Distinct voices with stable motivations and behavior continuity.';
  const artSeed =
    input.current.artStyle ||
    'Cinematic visual language with coherent palette and lighting intent.';
  const pacingSeed =
    input.current.storytellingPacing ||
    'Balanced pace: efficient setup, escalation through turning points, decisive payoff.';

  const writingStyle =
    typeof input.candidate.writingStyle === 'string' &&
    !isStyleTextUnderSpecified(input.candidate.writingStyle, request)
      ? input.candidate.writingStyle.trim()
      : `${requestSentence} Keep prose direction anchored to: ${writingSeed} Prioritize voice consistency, purposeful diction, and scene-level readability with concise transitions.`;

  const characterStyle =
    typeof input.candidate.characterStyle === 'string' &&
    !isStyleTextUnderSpecified(input.candidate.characterStyle, request)
      ? input.candidate.characterStyle.trim()
      : `${requestSentence} Keep character direction anchored to: ${characterSeed} Ensure each lead has a distinct speech pattern, explicit motivation, and behavior rules that remain consistent across scenes.`;

  const artStyle =
    typeof input.candidate.artStyle === 'string' &&
    !isStyleTextUnderSpecified(input.candidate.artStyle, request)
      ? input.candidate.artStyle.trim()
      : `${requestSentence} Keep art direction anchored to: ${artSeed} Define framing language, lens distance tendencies, color-temperature progression, and lighting contrast that matches emotional beats.`;

  const storytellingPacing =
    typeof input.candidate.storytellingPacing === 'string' &&
    !isStyleTextUnderSpecified(input.candidate.storytellingPacing, request)
      ? input.candidate.storytellingPacing.trim()
      : `${requestSentence} Keep pacing direction anchored to: ${pacingSeed} Structure each sequence with clear setup, progressive pressure, controlled reveals, and a payoff cadence that avoids rushed resolution.`;

  const extras = {
    ...input.current.extras,
    ...(input.candidate.extras
      ? normalizeStyleExtras(input.candidate.extras)
      : {}),
    LatestDirection: request,
    ProjectScope:
      'Apply style decisions project-wide across story prose, character portrayal, visual language, and sequence pacing.',
  };

  return {
    writingStyle,
    characterStyle,
    artStyle,
    storytellingPacing,
    extras,
  } satisfies ProjectStylePayload;
}

async function deriveStylePayloadWithSubAgent(input: {
  current: ProjectStylePayload;
  request: string;
}) {
  const prompt = [
    'You are a senior creative direction board for story pre-production.',
    'Operate as a professional: literary director, character director, art director/cinematographer, and narrative pacing editor.',
    'Task: update the project style profile from user request.',
    'Goal: produce detailed, production-ready guidance for the entire project scope while adapting to existing style information.',
    'Return strict JSON only with fields:',
    '{"writingStyle":"...","characterStyle":"...","artStyle":"...","storytellingPacing":"...","extras":{"key":"value"}}',
    'Rules:',
    '1) Always adapt to and preserve strong existing direction unless user explicitly replaces it.',
    '2) Expand terse requests into concrete direction. Avoid generic one-liners.',
    '3) Each core field should be specific and actionable (target roughly 2-4 sentences each).',
    '4) Determine project-level scope and fit: genre posture, audience experience, tone boundaries, and continuity constraints.',
    '5) Keep writingStyle focused on prose voice, diction, texture, and narration policy.',
    '6) Keep characterStyle focused on voice differentiation, motivation clarity, and behavioral consistency rules.',
    '7) Keep artStyle focused on visual language, composition/lens logic, color script, lighting, and texture references.',
    '8) Keep storytellingPacing focused on scene rhythm, escalation profile, reveal timing, and payoff cadence.',
    '9) Use extras for cross-cutting dimensions only (for example: ProjectScope, GenrePositioning, AudienceExperience, NegativeGuardrails, ContinuityRules).',
    '10) If request is broad (e.g. "create a fitting style"), fill all four core fields comprehensively instead of returning only extras.',
    '11) Do not output markdown fences.',
    '',
    `Current writingStyle: ${input.current.writingStyle || '(empty)'}`,
    `Current characterStyle: ${input.current.characterStyle || '(empty)'}`,
    `Current artStyle: ${input.current.artStyle || '(empty)'}`,
    `Current storytellingPacing: ${input.current.storytellingPacing || '(empty)'}`,
    `Current extras: ${JSON.stringify(input.current.extras)}`,
    '',
    `User adjustment request: ${input.request}`,
  ].join('\n');

  const response = await characterDerivationAi.models.generateContent({
    model: env.GEMINI_CHARACTER_SUBAGENT_MODEL,
    contents: prompt,
    config: {
      temperature: 0.3,
      responseMimeType: 'application/json',
    },
  });

  const text = extractJsonText(getGenerateContentText(response));
  if (!text) {
    return null;
  }

  const parsedUnknown = JSON.parse(text);
  const parsed = generatedStylePayloadSchema.safeParse(parsedUnknown);
  if (!parsed.success) {
    return null;
  }

  return {
    writingStyle: parsed.data.writingStyle,
    characterStyle: parsed.data.characterStyle,
    artStyle: parsed.data.artStyle,
    storytellingPacing: parsed.data.storytellingPacing,
    extras: normalizeStyleExtras(parsed.data.extras),
  } satisfies ProjectStylePayload;
}

async function ensureCanonicalStyleNode(context: ToolContext) {
  if (!context.projectId) {
    return {
      ok: false as const,
      message: 'This tool requires an active project context.',
    };
  }

  const access = await verifyProjectAccess(context);
  if (!access.ok) {
    return access;
  }

  const existingNodes = await prisma.styleNode.findMany({
    where: {
      projectId: context.projectId,
    },
    orderBy: {
      createdAt: 'asc',
    },
  });

  const canonical = existingNodes[0];
  if (!canonical) {
    const preferredPosition = await resolvePreferredStylePosition(
      context.projectId,
    );
    const initialPayload: ProjectStylePayload = {
      writingStyle: 'Clear, vivid prose that supports scene readability.',
      characterStyle:
        'Distinct voices and motivations with consistent behavior.',
      artStyle: 'Cinematic visual language with coherent mood and palette.',
      storytellingPacing:
        'Balanced pacing: concise setup, rising tension, sharp payoff.',
      extras: {},
    };

    const created = await prisma.styleNode.create({
      data: {
        projectId: context.projectId,
        name: 'Project Style Guide',
        description: buildStyleDescription(initialPayload),
        writingStyle: initialPayload.writingStyle,
        characterStyle: initialPayload.characterStyle,
        artStyle: initialPayload.artStyle,
        storytellingPacing: initialPayload.storytellingPacing,
        extrasJson: JSON.stringify(initialPayload.extras),
        positionX: preferredPosition.x,
        positionY: preferredPosition.y,
      },
    });

    return {
      ok: true as const,
      node: created,
      style: initialPayload,
      deduped: false,
    };
  }

  let node = canonical;
  const duplicates = existingNodes.slice(1);
  if (duplicates.length) {
    const duplicateIds = duplicates.map((item) => item.id);
    await prisma.styleNode.deleteMany({
      where: {
        id: {
          in: duplicateIds,
        },
      },
    });
  }

  const payload = toProjectStylePayload(node);
  const hasPersistedPosition =
    Number.isFinite(node.positionX) && Number.isFinite(node.positionY);
  const currentPosition = hasPersistedPosition
    ? {
        x: node.positionX as number,
        y: node.positionY as number,
      }
    : null;

  const preferredPosition = await resolvePreferredStylePosition(
    context.projectId,
    {
      ignoreStyleNodeId: node.id,
    },
  );
  const occupiedRects = await getOccupiedNodeRects(context.projectId, {
    ignoreStyleNodeId: node.id,
  });

  const currentRect =
    currentPosition != null
      ? buildRect({
          x: currentPosition.x,
          y: currentPosition.y,
          width: STYLE_NODE_SIZE.width,
          height: STYLE_NODE_SIZE.height,
        })
      : null;

  const currentOverlapsOccupied =
    currentRect != null &&
    occupiedRects.some((rect) => intersectsRect(currentRect, rect));

  const overlapsLegacyStoryDefault =
    hasPersistedPosition &&
    Math.abs((node.positionX as number) - STORY_DEFAULT_POSITION.x) < 0.5 &&
    Math.abs((node.positionY as number) - STORY_DEFAULT_POSITION.y) < 0.5;

  const needsLegacyBackfill =
    !normalizeStringValue(node.writingStyle) ||
    !normalizeStringValue(node.description) ||
    !normalizeStringValue(node.name) ||
    !hasPersistedPosition ||
    overlapsLegacyStoryDefault ||
    currentOverlapsOccupied;

  if (needsLegacyBackfill) {
    node = await prisma.styleNode.update({
      where: {
        id: node.id,
      },
      data: {
        name: normalizeStringValue(node.name) || 'Project Style Guide',
        description: buildStyleDescription(payload),
        writingStyle: payload.writingStyle,
        characterStyle: payload.characterStyle,
        artStyle: payload.artStyle,
        storytellingPacing: payload.storytellingPacing,
        extrasJson: JSON.stringify(payload.extras),
        ...(needsLegacyBackfill
          ? {
              positionX: preferredPosition.x,
              positionY: preferredPosition.y,
            }
          : {}),
      },
    });
  }

  return {
    ok: true as const,
    node,
    style: toProjectStylePayload(node),
    deduped: duplicates.length > 0,
  };
}

async function deriveCharacterDraftsFromStoryWithSubAgent(input: {
  storyTitle: string;
  markdown: string;
  maxCharacters: number;
}) {
  const prompt = [
    'You are a character extraction sub-agent for screenwriting pre-production.',
    'Task: derive character drafts from the story content.',
    'Rules:',
    '1) Return only human characters or person-like acting agents participating in events/dialogue.',
    '2) Exclude products, tools, apps, platforms, locations, organizations, and generic nouns.',
    `3) Return at most ${input.maxCharacters} characters, ranked by narrative importance.`,
    '4) description must be a short identity summary (who they are), max 1 sentence.',
    '5) traits should be concise and factual from story context (behavior/style/personality/goals/notes).',
    '6) If uncertain, omit the candidate instead of guessing.',
    'Output JSON only in this format:',
    '{"characters":[{"name":"...","description":"...","headImageUrl":"","traits":{"behavior":"","style":"","personality":"","goals":"","notes":""}}]}',
    '',
    `Story title: ${input.storyTitle}`,
    'Story markdown:',
    input.markdown,
  ].join('\n');

  const response = await characterDerivationAi.models.generateContent({
    model: env.GEMINI_CHARACTER_SUBAGENT_MODEL,
    contents: prompt,
    config: {
      temperature: 0.2,
      responseMimeType: 'application/json',
    },
  });

  const text = extractJsonText(getGenerateContentText(response));
  if (!text) {
    return [];
  }

  const parsedUnknown = JSON.parse(text);
  const parsed = generatedCharactersPayloadSchema.safeParse(parsedUnknown);
  if (!parsed.success) {
    return [];
  }

  return parsed.data.characters
    .map((character) =>
      parseCharacterDraft({
        name: character.name,
        description: character.description,
        headImageUrl: character.headImageUrl,
        traits: character.traits,
      }),
    )
    .filter((item): item is CharacterDraftInput => Boolean(item));
}

async function deriveCharacterDraftsFromStory(input: {
  storyTitle: string;
  markdown: string;
  maxCharacters: number;
}) {
  try {
    const viaSubAgent = await deriveCharacterDraftsFromStoryWithSubAgent(input);
    if (viaSubAgent.length) {
      return viaSubAgent;
    }
  } catch {
    // Fall back to deterministic heuristics if sub-agent completion fails.
  }

  return deriveCharacterDraftsFromStoryHeuristic(input);
}

function parseCharacterDraftsFromArgs(
  args: Record<string, unknown>,
): CharacterDraftParseResult {
  const optionsResult = characterAutoOptionsSchema.safeParse({
    fromStory: args.fromStory,
    maxCharacters: args.maxCharacters,
  });

  if (!optionsResult.success) {
    return {
      ok: false,
      message: 'Invalid story-derivation options for generate_character_brief.',
      issues: formatValidationIssues(optionsResult.error.issues),
    };
  }

  const autoFromStory = optionsResult.data.fromStory ?? true;
  const maxCharacters = optionsResult.data.maxCharacters ?? 6;
  const rawCharacters = args.characters;

  if (Array.isArray(rawCharacters)) {
    if (!rawCharacters.length && autoFromStory) {
      return {
        ok: true,
        drafts: [],
        autoFromStory: true,
        maxCharacters,
      };
    }

    const parsedCharacters = characterInputArraySchema.safeParse(rawCharacters);
    if (!parsedCharacters.success) {
      return {
        ok: false,
        message:
          'Invalid characters payload. Provide a non-empty characters array with valid character objects.',
        issues: formatValidationIssues(parsedCharacters.error.issues),
      };
    }

    const drafts = parsedCharacters.data
      .map((item) => parseCharacterDraft(item))
      .filter((item): item is CharacterDraftInput => Boolean(item));

    if (!drafts.length) {
      return {
        ok: false,
        message:
          'generate_character_brief requires at least one valid character with a non-empty name.',
        issues: ['characters: no valid character entries were provided'],
      };
    }

    return {
      ok: true,
      drafts,
      autoFromStory: false,
      maxCharacters,
    };
  }

  const legacyName = normalizeStringValue(args.name);
  if (!legacyName) {
    if (!autoFromStory) {
      return {
        ok: false,
        message:
          'No character names were provided and story derivation is disabled.',
        issues: [
          'Provide characters[] or name, or set fromStory=true to derive from the active story node.',
        ],
      };
    }

    return {
      ok: true,
      drafts: [],
      autoFromStory: true,
      maxCharacters,
    };
  }

  const legacyInput = {
    name: legacyName,
    description: args.description,
    brief: args.brief ?? 'Character brief generated from story context.',
    headImageUrl: args.headImageUrl,
    traits: args.traits,
    behavior: args.behavior,
    style: args.style,
    personality: args.personality,
    goals: args.goals,
    notes: args.notes,
  };

  const parsedLegacy = characterInputSchema.safeParse(legacyInput);
  if (!parsedLegacy.success) {
    return {
      ok: false,
      message: 'Invalid character payload for legacy single-character input.',
      issues: formatValidationIssues(parsedLegacy.error.issues),
    };
  }

  const legacyDraft = parseCharacterDraft(parsedLegacy.data);

  if (!legacyDraft) {
    return {
      ok: false,
      message:
        'generate_character_brief requires at least one valid character with a non-empty name.',
      issues: ['name: character name is required'],
    };
  }

  return {
    ok: true,
    drafts: [legacyDraft],
    autoFromStory: false,
    maxCharacters,
  };
}

async function syncStoryNodeState(
  context: ToolContext,
  input: StoryNodeSyncInput,
) {
  if (!context.projectId) {
    return {
      ok: false,
      message: 'No active project is set for story sync.',
    };
  }

  const defaultTitle = input.defaultTitle?.trim() || 'Untitled Story';

  const projectGraph = await prisma.project.findFirst({
    where: {
      id: context.projectId,
      userId: context.userId,
    },
    select: {
      id: true,
      story: {
        select: {
          id: true,
          title: true,
          markdown: true,
          sourceDocUrl: true,
          updatedAt: true,
        },
      },
      characterNodes: {
        select: {
          id: true,
        },
        orderBy: {
          createdAt: 'asc',
        },
      },
      styleNodes: {
        select: {
          id: true,
        },
        orderBy: {
          createdAt: 'asc',
        },
      },
      storyboardNodes: {
        select: {
          id: true,
        },
        orderBy: {
          createdAt: 'asc',
        },
      },
    },
  });

  if (!projectGraph) {
    return {
      ok: false,
      message: 'Active project was not found for this user.',
    };
  }

  const requestedStoryNodeId = input.requestedStoryNodeId?.trim() || null;
  const existingStory = projectGraph.story;
  const existingStoryNodeId = existingStory?.id ?? null;
  const requestedNodeExists = Boolean(
    requestedStoryNodeId && requestedStoryNodeId === existingStoryNodeId,
  );

  let nextStory = existingStory;
  let syncAction: 'created' | 'updated' = 'updated';

  if (!existingStory) {
    syncAction = 'created';
    nextStory = await prisma.story.create({
      data: {
        projectId: context.projectId,
        title: defaultTitle,
        markdown: '',
        sourceDocUrl: null,
        backgroundPrompt: null,
      },
      select: {
        id: true,
        title: true,
        markdown: true,
        sourceDocUrl: true,
        updatedAt: true,
      },
    });
  } else {
    const nextTitle = defaultTitle || existingStory.title;
    nextStory = await prisma.story.update({
      where: {
        id: existingStory.id,
      },
      data: {
        title: nextTitle,
      },
      select: {
        id: true,
        title: true,
        markdown: true,
        sourceDocUrl: true,
        updatedAt: true,
      },
    });
  }

  const resolvedStoryNodeId = nextStory.id;
  const requestedNodeMissing = Boolean(
    requestedStoryNodeId && requestedStoryNodeId !== resolvedStoryNodeId,
  );

  const message = requestedNodeMissing
    ? 'Requested story node ID was not found. Synced with the active story node ID instead.'
    : syncAction === 'created'
      ? 'Story node did not exist and has been created.'
      : 'Story node exists and has been updated.';

  return {
    ok: true,
    message,
    story: nextStory,
    sync: {
      action: syncAction,
      requestedStoryNodeId,
      requestedNodeExists,
      resolvedStoryNodeId,
      requestedNodeMissing,
    },
    relatedNodes: {
      storyNodeId: resolvedStoryNodeId,
      characterNodeIds: projectGraph.characterNodes.map((node) => node.id),
      styleNodeIds: projectGraph.styleNodes.map((node) => node.id),
      storyboardNodeIds: projectGraph.storyboardNodes.map((node) => node.id),
    },
    ui: {
      defaultTabType: input.defaultTabType ?? 'markdown',
    },
  };
}

export async function createProjectTool(context: ToolContext) {
  const rawName = context.args.name;
  const name = typeof rawName === 'string' ? rawName.trim() : '';

  if (!name) {
    return {
      ok: false,
      message: 'create_project requires a non-empty "name" argument.',
    };
  }

  if (name.length > 120) {
    return {
      ok: false,
      message: 'Project name must be at most 120 characters.',
    };
  }

  const project = await prisma.project.create({
    data: {
      userId: context.userId,
      name,
    },
    select: {
      id: true,
      name: true,
      description: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return {
    ok: true,
    project,
  };
}

export async function setActiveProjectTool(context: ToolContext) {
  const rawProjectId = context.args.projectId;
  const rawName = context.args.name;

  const projectId = typeof rawProjectId === 'string' ? rawProjectId.trim() : '';
  const name = typeof rawName === 'string' ? rawName.trim() : '';

  if (!projectId && !name) {
    return {
      ok: false,
      message: 'set_active_project requires either "projectId" or "name".',
    };
  }

  const project = await prisma.project.findFirst({
    where: {
      userId: context.userId,
      ...(projectId ? { id: projectId } : { name }),
    },
    select: {
      id: true,
      name: true,
      description: true,
      updatedAt: true,
    },
  });

  if (!project) {
    return {
      ok: false,
      message: projectId
        ? `Project "${projectId}" was not found for this user.`
        : `Project named "${name}" was not found for this user.`,
    };
  }

  return {
    ok: true,
    message:
      'Active project resolved. Use agent.context with returned projectId.',
    project,
    agentContext: {
      projectId: project.id,
    },
  };
}

export async function createStoryNodeTool(context: ToolContext) {
  const projectAccess = await verifyProjectAccess(context);
  if (!projectAccess.ok) {
    return projectAccess;
  }

  const defaultTabType = normalizeDefaultTabType(context.args.defaultTabType);
  const title = normalizeOptionalTrimmedString(context.args.title);

  const result = await syncStoryNodeState(context, {
    defaultTitle: title || 'Untitled Story',
    defaultTabType,
    requestedStoryNodeId: normalizeOptionalTrimmedString(
      context.args.storyNodeId,
    ),
  });

  if (!result.ok || !('sync' in result)) {
    return result;
  }

  return {
    ...result,
    message:
      result.sync?.action === 'created'
        ? 'Story node is ready. It was missing and has been created for this project.'
        : 'Story node is ready in this project. Use the returned story.id for any follow-up updates.',
  };
}

export async function syncStoryNodeTool(context: ToolContext) {
  const projectAccess = await verifyProjectAccess(context);
  if (!projectAccess.ok) {
    return projectAccess;
  }

  const defaultTabType = normalizeDefaultTabType(context.args.defaultTabType);
  const title = normalizeOptionalTrimmedString(context.args.title);
  const requestedStoryNodeId = normalizeOptionalTrimmedString(
    context.args.storyNodeId,
  );

  const result = await syncStoryNodeState(context, {
    defaultTitle: title || 'Untitled Story',
    defaultTabType,
    requestedStoryNodeId,
  });

  if (!result.ok || !('sync' in result)) {
    return result;
  }

  return {
    ...result,
    message:
      'Related nodes were resolved and story node sync completed. Use sync.resolvedStoryNodeId for reliable follow-up operations.',
  };
}

export async function listProjectsTool(context: ToolContext) {
  const projects = await prisma.project.findMany({
    where: { userId: context.userId },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      name: true,
      description: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          characterNodes: true,
          styleNodes: true,
          storyboardNodes: true,
        },
      },
      story: {
        select: {
          id: true,
          title: true,
          updatedAt: true,
        },
      },
    },
  });

  return {
    ok: true,
    count: projects.length,
    projects,
  };
}

export async function listCharacterNodesTool(context: ToolContext) {
  const projectAccess = await verifyProjectAccess(context);
  if (!projectAccess.ok) {
    return projectAccess;
  }

  const projectId = context.projectId;
  if (!projectId) {
    return {
      ok: false,
      message: 'Active project was not found for this user.',
    };
  }

  const nodes = await prisma.characterNode.findMany({
    where: {
      projectId,
    },
    orderBy: {
      createdAt: 'asc',
    },
    select: {
      id: true,
      name: true,
      briefMarkdown: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return {
    ok: true,
    count: nodes.length,
    characterNodes: nodes.map((node) => ({
      id: node.id,
      name: node.name,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      briefPreview: node.briefMarkdown.slice(0, 180),
    })),
  };
}

export async function generateCharacterBriefTool(context: ToolContext) {
  const projectAccess = await verifyProjectAccess(context);
  if (!projectAccess.ok) {
    return projectAccess;
  }

  const projectId = context.projectId;
  if (!projectId) {
    return {
      ok: false,
      message: 'Active project was not found for this user.',
    };
  }

  const projectWithStory = await prisma.project.findFirst({
    where: {
      id: projectId,
      userId: context.userId,
    },
    select: {
      story: {
        select: {
          id: true,
          title: true,
          markdown: true,
          updatedAt: true,
        },
      },
    },
  });

  const storyContext = {
    storyNodeId: projectWithStory?.story?.id ?? null,
    title: projectWithStory?.story?.title?.trim() || null,
    markdown: projectWithStory?.story?.markdown ?? '',
    updatedAt: projectWithStory?.story?.updatedAt ?? null,
  };

  const parsedDrafts = parseCharacterDraftsFromArgs(context.args);
  if (!parsedDrafts.ok) {
    return {
      ok: false,
      message: parsedDrafts.message,
      issues: parsedDrafts.issues,
      storyContext,
    };
  }

  let drafts = parsedDrafts.drafts;
  let derivedFromStory = false;

  if (!drafts.length && parsedDrafts.autoFromStory) {
    const storyTitle = storyContext.title || 'Untitled Story';
    const storyMarkdown = storyContext.markdown.trim();

    if (!storyMarkdown) {
      return {
        ok: false,
        message:
          'No story content is available in the active project. Import or save story markdown first, or provide character names directly.',
        storyContext,
      };
    }

    drafts = await deriveCharacterDraftsFromStory({
      storyTitle,
      markdown: storyMarkdown,
      maxCharacters: parsedDrafts.maxCharacters,
    });

    if (!drafts.length) {
      return {
        ok: false,
        message:
          'Could not detect character names from the current story node. Provide explicit character names or update the story text with clearer character references.',
        storyContext,
      };
    }

    derivedFromStory = true;
  }

  const seenDraftNames = new Set<string>();
  const skippedDuplicateInputNames: string[] = [];
  const uniqueDrafts: CharacterDraftInput[] = [];
  for (const draft of drafts) {
    const normalizedName = draft.name.trim().toLowerCase();
    if (!normalizedName) {
      continue;
    }

    if (seenDraftNames.has(normalizedName)) {
      skippedDuplicateInputNames.push(draft.name);
      continue;
    }

    seenDraftNames.add(normalizedName);
    uniqueDrafts.push(draft);
  }

  const existingCharacterNodes = await prisma.characterNode.findMany({
    where: {
      projectId,
    },
    select: {
      name: true,
    },
  });
  const existingNames = new Set(
    existingCharacterNodes
      .map((node) => node.name.trim().toLowerCase())
      .filter(Boolean),
  );

  const skippedExistingNames: string[] = [];
  const draftsToCreate = uniqueDrafts.filter((draft) => {
    const normalizedName = draft.name.trim().toLowerCase();
    if (!normalizedName) {
      return false;
    }

    if (existingNames.has(normalizedName)) {
      skippedExistingNames.push(draft.name);
      return false;
    }

    return true;
  });

  const createdNodes: Array<{
    id: string;
    projectId: string;
    name: string;
    briefMarkdown: string;
    profileJson: string | null;
    inspirationPrompt: string | null;
    inspirationUrls: string[];
    createdAt: Date;
    updatedAt: Date;
  }> = [];
  const allocatedPositions = await allocateNodePositions(
    projectId,
    draftsToCreate.length,
  );

  for (const [index, draft] of draftsToCreate.entries()) {
    const allocatedPosition = allocatedPositions[index];
    const briefMarkdown = buildCharacterBriefMarkdown(draft);
    const profileJson = Object.keys(draft.profile).length
      ? JSON.stringify(draft.profile)
      : null;

    const node = await prisma.characterNode.create({
      data: {
        projectId,
        name: draft.name,
        briefMarkdown,
        profileJson,
        inspirationUrls: [],
        positionX: allocatedPosition?.x ?? 640,
        positionY: allocatedPosition?.y ?? 120,
      },
      select: {
        id: true,
        projectId: true,
        name: true,
        briefMarkdown: true,
        profileJson: true,
        inspirationPrompt: true,
        inspirationUrls: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    createdNodes.push(node);
  }

  const projectGraph = await prisma.project.findFirst({
    where: {
      id: projectId,
      userId: context.userId,
    },
    select: {
      characterNodes: {
        select: {
          id: true,
        },
        orderBy: {
          createdAt: 'asc',
        },
      },
    },
  });

  const createdCount = createdNodes.length;
  const skippedCount =
    skippedExistingNames.length + skippedDuplicateInputNames.length;

  let message = derivedFromStory
    ? createdCount === 1
      ? 'Derived 1 character from the active story node and created its brief node.'
      : createdCount > 1
        ? `Derived ${createdCount} characters from the active story node and created their brief nodes.`
        : 'No new character brief nodes were created because matching characters already exist.'
    : createdCount === 1
      ? 'Created 1 character brief node for the active project.'
      : createdCount > 1
        ? `Created ${createdCount} character brief nodes for the active project.`
        : 'No new character brief nodes were created because matching characters already exist.';

  if (skippedCount > 0) {
    message = `${message} Skipped ${skippedCount} duplicate character name${skippedCount === 1 ? '' : 's'}.`;
  }

  return {
    ok: true,
    message,
    storyContext,
    createdCount,
    createdNodes,
    skippedCount,
    skippedExistingNames,
    skippedDuplicateInputNames,
    relatedNodes: {
      characterNodeIds:
        projectGraph?.characterNodes.map((node) => node.id) ??
        createdNodes.map((node) => node.id),
    },
  };
}

export async function updateCharacterBriefTool(context: ToolContext) {
  const projectAccess = await verifyProjectAccess(context);
  if (!projectAccess.ok) {
    return projectAccess;
  }

  const projectId = context.projectId;
  if (!projectId) {
    return {
      ok: false,
      message: 'Active project was not found for this user.',
    };
  }

  const parsedArgs = characterBriefUpdateArgsSchema.safeParse(context.args);
  if (!parsedArgs.success) {
    return {
      ok: false,
      message: 'Invalid payload for update_character_brief.',
      issues: formatValidationIssues(parsedArgs.error.issues),
    };
  }

  const args = parsedArgs.data;
  const targetById = normalizeStringValue(args.characterNodeId);
  const hasAnyPatchField =
    Object.prototype.hasOwnProperty.call(context.args, 'nextName') ||
    Object.prototype.hasOwnProperty.call(context.args, 'description') ||
    Object.prototype.hasOwnProperty.call(context.args, 'brief') ||
    Object.prototype.hasOwnProperty.call(context.args, 'briefMarkdown') ||
    Object.prototype.hasOwnProperty.call(context.args, 'headImageUrl') ||
    Object.prototype.hasOwnProperty.call(context.args, 'traits') ||
    Object.prototype.hasOwnProperty.call(context.args, 'behavior') ||
    Object.prototype.hasOwnProperty.call(context.args, 'style') ||
    Object.prototype.hasOwnProperty.call(context.args, 'personality') ||
    Object.prototype.hasOwnProperty.call(context.args, 'goals') ||
    Object.prototype.hasOwnProperty.call(context.args, 'notes');

  if (!hasAnyPatchField) {
    return {
      ok: false,
      message:
        'update_character_brief requires at least one field to update (for example: brief, behavior, style, or notes).',
    };
  }

  if (!targetById) {
    return {
      ok: false,
      message:
        'update_character_brief requires characterNodeId. Call list_character_nodes first to find the correct node ID.',
    };
  }

  let existingNode: {
    id: string;
    name: string;
    briefMarkdown: string;
    profileJson: string | null;
    inspirationPrompt: string | null;
    inspirationUrls: string[];
    createdAt: Date;
    updatedAt: Date;
  } | null = null;
  existingNode = await prisma.characterNode.findFirst({
    where: {
      id: targetById,
      projectId,
    },
    select: {
      id: true,
      name: true,
      briefMarkdown: true,
      profileJson: true,
      inspirationPrompt: true,
      inspirationUrls: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!existingNode) {
    return {
      ok: false,
      message: `Character node "${targetById}" was not found in the active project.`,
    };
  }

  const currentProfile = parseCharacterProfileRecord(existingNode.profileJson);
  const currentAttributes =
    currentProfile.attributes && typeof currentProfile.attributes === 'object'
      ? { ...currentProfile.attributes }
      : ({} as Record<string, string>);

  const nextName =
    Object.prototype.hasOwnProperty.call(context.args, 'nextName') &&
    typeof args.nextName === 'string'
      ? args.nextName
      : existingNode.name;

  const description =
    Object.prototype.hasOwnProperty.call(context.args, 'description') &&
    typeof args.description === 'string'
      ? args.description
      : normalizeStringValue(currentProfile.description);
  const headImageUrl =
    Object.prototype.hasOwnProperty.call(context.args, 'headImageUrl') &&
    typeof args.headImageUrl === 'string'
      ? args.headImageUrl
      : normalizeStringValue(currentProfile.headImageUrl);
  const currentBehavior = normalizeStringValue(currentProfile.behavior);
  const currentStyle = normalizeStringValue(currentProfile.style);
  const currentPersonality = normalizeStringValue(currentProfile.personality);
  const currentGoals = normalizeStringValue(currentProfile.goals);
  const currentNotes = normalizeStringValue(currentProfile.notes);

  const incomingTraits =
    args.traits && typeof args.traits === 'object'
      ? (args.traits as Record<string, unknown>)
      : null;

  const traitBehavior = incomingTraits
    ? normalizeStringValue(incomingTraits.behavior || incomingTraits.behaviour)
    : '';
  const traitStyle = incomingTraits
    ? normalizeStringValue(incomingTraits.style)
    : '';
  const traitPersonality = incomingTraits
    ? normalizeStringValue(incomingTraits.personality)
    : '';
  const traitGoals = incomingTraits
    ? normalizeStringValue(incomingTraits.goals)
    : '';
  const traitNotes = incomingTraits
    ? normalizeStringValue(incomingTraits.notes)
    : '';

  const hasBehaviorArg = Object.prototype.hasOwnProperty.call(
    context.args,
    'behavior',
  );
  const hasStyleArg = Object.prototype.hasOwnProperty.call(
    context.args,
    'style',
  );
  const hasPersonalityArg = Object.prototype.hasOwnProperty.call(
    context.args,
    'personality',
  );
  const hasGoalsArg = Object.prototype.hasOwnProperty.call(
    context.args,
    'goals',
  );
  const hasNotesArg = Object.prototype.hasOwnProperty.call(
    context.args,
    'notes',
  );

  const hasTraitBehavior =
    incomingTraits !== null &&
    ('behavior' in incomingTraits || 'behaviour' in incomingTraits);
  const hasTraitStyle = incomingTraits !== null && 'style' in incomingTraits;
  const hasTraitPersonality =
    incomingTraits !== null && 'personality' in incomingTraits;
  const hasTraitGoals = incomingTraits !== null && 'goals' in incomingTraits;
  const hasTraitNotes = incomingTraits !== null && 'notes' in incomingTraits;

  const behavior = hasBehaviorArg
    ? normalizeStringValue(args.behavior)
    : hasTraitBehavior
      ? traitBehavior
      : currentBehavior;
  const style = hasStyleArg
    ? normalizeStringValue(args.style)
    : hasTraitStyle
      ? traitStyle
      : currentStyle;
  const personality = hasPersonalityArg
    ? normalizeStringValue(args.personality)
    : hasTraitPersonality
      ? traitPersonality
      : currentPersonality;
  const goals = hasGoalsArg
    ? normalizeStringValue(args.goals)
    : hasTraitGoals
      ? traitGoals
      : currentGoals;
  const notes = hasNotesArg
    ? normalizeStringValue(args.notes)
    : hasTraitNotes
      ? traitNotes
      : currentNotes;

  const mergedProfile: CharacterProfilePayload = {
    ...currentProfile,
    description,
    headImageUrl,
    behavior,
    style,
    personality,
    goals,
    notes,
  };

  if (incomingTraits) {
    for (const [key, value] of Object.entries(incomingTraits)) {
      const normalizedKey = key.trim();
      if (!normalizedKey || CHARACTER_CANONICAL_KEYS.has(normalizedKey)) {
        continue;
      }

      const normalizedValue = stringifyUnknownValue(value);
      if (!normalizedValue) {
        continue;
      }

      currentAttributes[normalizedKey] = normalizedValue;
    }
  }

  if (Object.keys(currentAttributes).length) {
    mergedProfile.attributes = currentAttributes;
  }

  if (!description) {
    delete mergedProfile.description;
  }
  if (!headImageUrl) {
    delete mergedProfile.headImageUrl;
  }
  if (!mergedProfile.behavior) {
    delete mergedProfile.behavior;
  }
  if (!mergedProfile.style) {
    delete mergedProfile.style;
  }
  if (!mergedProfile.personality) {
    delete mergedProfile.personality;
  }
  if (!mergedProfile.goals) {
    delete mergedProfile.goals;
  }
  if (!mergedProfile.notes) {
    delete mergedProfile.notes;
  }

  const briefOverride =
    (Object.prototype.hasOwnProperty.call(context.args, 'brief') &&
      typeof args.brief === 'string') ||
    (Object.prototype.hasOwnProperty.call(context.args, 'briefMarkdown') &&
      typeof args.briefMarkdown === 'string')
      ? normalizeStringValue(args.brief || args.briefMarkdown)
      : null;

  const generatedDraft = parseCharacterDraft({
    name: nextName,
    description,
    headImageUrl,
    behavior: mergedProfile.behavior,
    style: mergedProfile.style,
    personality: mergedProfile.personality,
    goals: mergedProfile.goals,
    notes: mergedProfile.notes,
    traits: mergedProfile.attributes,
  });

  const nextBriefMarkdown =
    briefOverride !== null
      ? briefOverride
      : generatedDraft
        ? buildCharacterBriefMarkdown(generatedDraft)
        : existingNode.briefMarkdown;

  const updated = await prisma.characterNode.update({
    where: {
      id: existingNode.id,
    },
    data: {
      name: nextName,
      briefMarkdown: nextBriefMarkdown,
      profileJson: JSON.stringify(mergedProfile),
    },
    select: {
      id: true,
      projectId: true,
      name: true,
      briefMarkdown: true,
      profileJson: true,
      inspirationPrompt: true,
      inspirationUrls: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return {
    ok: true,
    message: `Updated character brief for "${updated.name}".`,
    updatedNode: updated,
    matchInfo: {
      matchedBy: 'characterNodeId',
    },
  };
}

export async function generateCharacterInspirationTool(context: ToolContext) {
  return upsertProjectStyleNodeTool({
    ...context,
    args: {
      ...context.args,
      styleName:
        normalizeOptionalTrimmedString(context.args.styleName) ||
        'Project Style Guide',
      description:
        normalizeOptionalTrimmedString(context.args.description) ||
        'Generated style reference from story and character brief.',
    },
  });
}

export async function getProjectStyleNodeTool(context: ToolContext) {
  const canonical = await ensureCanonicalStyleNode(context);
  if (!canonical.ok) {
    return canonical;
  }

  return {
    ok: true,
    message: canonical.deduped
      ? 'Canonical style node resolved and duplicate style nodes were consolidated.'
      : 'Canonical style node resolved for active project.',
    styleNode: canonical.node,
    styleProfile: canonical.style,
  };
}

export async function upsertProjectStyleNodeTool(context: ToolContext) {
  const parsed = stylePatchSchema.safeParse(context.args);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Invalid style payload for upsert_project_style_node.',
      issues: formatValidationIssues(parsed.error.issues),
    };
  }

  const canonical = await ensureCanonicalStyleNode(context);
  if (!canonical.ok) {
    return canonical;
  }

  const payload = parsed.data;
  const legacyDescription = normalizeStringValue(payload.description);
  const directPatch: Partial<ProjectStylePayload> = {
    ...(payload.writingStyle !== undefined
      ? { writingStyle: payload.writingStyle }
      : legacyDescription
        ? { writingStyle: legacyDescription }
        : {}),
    ...(payload.characterStyle !== undefined
      ? { characterStyle: payload.characterStyle }
      : {}),
    ...(payload.artStyle !== undefined ? { artStyle: payload.artStyle } : {}),
    ...(payload.storytellingPacing !== undefined
      ? { storytellingPacing: payload.storytellingPacing }
      : {}),
    ...(payload.extras ? { extras: normalizeStyleExtras(payload.extras) } : {}),
  };

  const next = mergeStylePayload({
    current: canonical.style,
    patch: directPatch,
    replace: Boolean(payload.replace),
  });

  const updated = await prisma.styleNode.update({
    where: {
      id: canonical.node.id,
    },
    data: {
      name:
        normalizeStringValue(payload.styleName || payload.name) ||
        normalizeStringValue(canonical.node.name) ||
        'Project Style Guide',
      description: buildStyleDescription(next),
      writingStyle: next.writingStyle,
      characterStyle: next.characterStyle,
      artStyle: next.artStyle,
      storytellingPacing: next.storytellingPacing,
      extrasJson: JSON.stringify(next.extras),
    },
  });

  emitRuntimeEvent(context, {
    type: 'agent.style.updated',
    payload: {
      projectId: context.projectId,
      sourceTool: 'upsert_project_style_node',
      styleNode: updated,
      styleProfile: next,
    },
  });

  return {
    ok: true,
    message: 'Project style node updated.',
    updateMode: 'direct' satisfies StyleRefineMode,
    styleNode: updated,
    styleProfile: next,
  };
}

export async function refineProjectStyleNodeTool(context: ToolContext) {
  const parsed = styleRefineSchema.safeParse(context.args);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Invalid style refine payload.',
      issues: formatValidationIssues(parsed.error.issues),
    };
  }

  const canonical = await ensureCanonicalStyleNode(context);
  if (!canonical.ok) {
    return canonical;
  }

  const payload = parsed.data;
  const delegateToSubAgent = true;

  let mode: StyleRefineMode = 'direct';
  let basePatch = inferStylePatchFromRequest(payload.request);

  if (delegateToSubAgent) {
    try {
      const refined = await deriveStylePayloadWithSubAgent({
        current: canonical.style,
        request: payload.request,
      });
      if (refined) {
        basePatch = refined;
        mode = 'subagent_refine';
      }
    } catch {
      // Fall back to deterministic direct patch if sub-agent generation fails.
    }
  }

  if (payload.request.trim()) {
    basePatch = buildExpandedStylePatchFromRequest({
      current: canonical.style,
      request: payload.request,
      candidate: basePatch,
    });
  }

  const directPatch: Partial<ProjectStylePayload> = {
    ...basePatch,
    ...(payload.writingStyle !== undefined
      ? { writingStyle: payload.writingStyle }
      : {}),
    ...(payload.characterStyle !== undefined
      ? { characterStyle: payload.characterStyle }
      : {}),
    ...(payload.artStyle !== undefined ? { artStyle: payload.artStyle } : {}),
    ...(payload.storytellingPacing !== undefined
      ? { storytellingPacing: payload.storytellingPacing }
      : {}),
    ...(payload.extras ? { extras: normalizeStyleExtras(payload.extras) } : {}),
  };

  const next = mergeStylePayload({
    current: canonical.style,
    patch: directPatch,
    replace: Boolean(payload.replace),
  });

  const updated = await prisma.styleNode.update({
    where: {
      id: canonical.node.id,
    },
    data: {
      name:
        normalizeStringValue(payload.styleName || payload.name) ||
        normalizeStringValue(canonical.node.name) ||
        'Project Style Guide',
      description: buildStyleDescription(next),
      writingStyle: next.writingStyle,
      characterStyle: next.characterStyle,
      artStyle: next.artStyle,
      storytellingPacing: next.storytellingPacing,
      extrasJson: JSON.stringify(next.extras),
    },
  });

  emitRuntimeEvent(context, {
    type: 'agent.style.updated',
    payload: {
      projectId: context.projectId,
      sourceTool: 'refine_project_style_node',
      styleNode: updated,
      styleProfile: next,
      updateMode: mode,
    },
  });

  return {
    ok: true,
    message:
      mode === 'subagent_refine'
        ? 'Project style node refined via sub-agent and updated.'
        : 'Project style node refined with direct update logic.',
    updateMode: mode,
    styleNode: updated,
    styleProfile: next,
  };
}

async function generateCharacterDesignForNode(input: {
  characterNode: {
    id: string;
    name: string;
    briefMarkdown: string;
    profileJson: string | null;
  };
  style: ProjectStylePayload;
  optionsCount: number;
  replaceExisting: boolean;
}) {
  const profile = parseCharacterProfileRecord(input.characterNode.profileJson);
  const prompt = buildCharacterDesignPrompt({
    characterName: input.characterNode.name,
    briefMarkdown: input.characterNode.briefMarkdown,
    profile,
    style: input.style,
  });

  const generated = await generateCharacterDesignOptions({
    prompt,
    optionsCount: input.optionsCount,
  });

  if (!generated.length) {
    return {
      ok: false as const,
      message: `No image options were generated for ${input.characterNode.name}.`,
    };
  }

  const existingOptions = normalizeCharacterDesignOptions(
    profile.characterDesigns,
  );
  const mergedOptions = mergeCharacterDesignOptions({
    current: existingOptions,
    generated,
    replaceExisting: input.replaceExisting,
  });

  const selectedCharacterDesignId = normalizeStringValue(
    profile.selectedCharacterDesignId,
  );
  const nextSelectedId =
    selectedCharacterDesignId &&
    mergedOptions.some((option) => option.id === selectedCharacterDesignId)
      ? selectedCharacterDesignId
      : generated[0]?.id || null;

  const nextProfile: CharacterProfilePayload = {
    ...profile,
    headImageUrl:
      mergedOptions.find((option) => option.id === nextSelectedId)?.imageUrl ||
      profile.headImageUrl,
    characterDesigns: mergedOptions,
    selectedCharacterDesignId: nextSelectedId || undefined,
    characterDesignPrompt: prompt,
    characterDesignGeneratedAt: new Date().toISOString(),
  };

  const updated = await prisma.characterNode.update({
    where: {
      id: input.characterNode.id,
    },
    data: {
      profileJson: JSON.stringify(nextProfile),
    },
    select: {
      id: true,
      name: true,
      briefMarkdown: true,
      profileJson: true,
      positionX: true,
      positionY: true,
      updatedAt: true,
    },
  });

  return {
    ok: true as const,
    message: `Generated ${generated.length} design option(s) for ${updated.name}.`,
    node: updated,
    generatedCount: generated.length,
    selectedCharacterDesignId: nextSelectedId,
  };
}

export async function regenerateCharacterDesignOptionsForUser(input: {
  userId: string;
  projectId: string;
  characterNodeId: string;
  optionsCount?: number;
}) {
  const project = await prisma.project.findFirst({
    where: {
      id: input.projectId,
      userId: input.userId,
    },
    select: {
      id: true,
    },
  });

  if (!project) {
    return {
      ok: false as const,
      message: 'Project not found for this user.',
    };
  }

  const node = await prisma.characterNode.findFirst({
    where: {
      id: input.characterNodeId,
      projectId: input.projectId,
    },
    select: {
      id: true,
      name: true,
      briefMarkdown: true,
      profileJson: true,
    },
  });

  if (!node) {
    return {
      ok: false as const,
      message: 'Character node not found in this project.',
    };
  }

  const styleNode = await prisma.styleNode.findFirst({
    where: {
      projectId: input.projectId,
    },
    orderBy: {
      createdAt: 'asc',
    },
  });

  const style = styleNode
    ? toProjectStylePayload(styleNode)
    : {
        writingStyle: '',
        characterStyle: '',
        artStyle: '',
        storytellingPacing: '',
        extras: {},
      };

  return generateCharacterDesignForNode({
    characterNode: node,
    style,
    optionsCount: input.optionsCount ?? 3,
    replaceExisting: true,
  });
}

export async function selectCharacterDesignOptionForUser(input: {
  userId: string;
  projectId: string;
  characterNodeId: string;
  optionId: string;
}) {
  const node = await prisma.characterNode.findFirst({
    where: {
      id: input.characterNodeId,
      projectId: input.projectId,
      project: {
        userId: input.userId,
      },
    },
    select: {
      id: true,
      profileJson: true,
    },
  });

  if (!node) {
    return {
      ok: false as const,
      message: 'Character node not found in this project.',
    };
  }

  const profile = parseCharacterProfileRecord(node.profileJson);
  const options = normalizeCharacterDesignOptions(profile.characterDesigns);
  const selected = options.find((item) => item.id === input.optionId);

  if (!selected) {
    return {
      ok: false as const,
      message: 'Requested design option does not exist for this character.',
    };
  }

  const nextProfile: CharacterProfilePayload = {
    ...profile,
    selectedCharacterDesignId: selected.id,
    headImageUrl: selected.imageUrl,
  };

  const updated = await prisma.characterNode.update({
    where: {
      id: node.id,
    },
    data: {
      profileJson: JSON.stringify(nextProfile),
    },
    select: {
      id: true,
      name: true,
      briefMarkdown: true,
      profileJson: true,
      positionX: true,
      positionY: true,
      updatedAt: true,
    },
  });

  return {
    ok: true as const,
    message: 'Character design selection updated.',
    node: updated,
  };
}

export async function updateCharacterDesignNodePositionForUser(input: {
  userId: string;
  projectId: string;
  characterNodeId: string;
  positionX: number;
  positionY: number;
}) {
  const node = await prisma.characterNode.findFirst({
    where: {
      id: input.characterNodeId,
      projectId: input.projectId,
      project: {
        userId: input.userId,
      },
    },
    select: {
      id: true,
      profileJson: true,
    },
  });

  if (!node) {
    return {
      ok: false as const,
      message: 'Character node not found in this project.',
    };
  }

  const profile = parseCharacterProfileRecord(node.profileJson);
  const nextProfile: CharacterProfilePayload = {
    ...profile,
    characterDesignNodePosition: {
      x: input.positionX,
      y: input.positionY,
    },
  };

  await prisma.characterNode.update({
    where: {
      id: node.id,
    },
    data: {
      profileJson: JSON.stringify(nextProfile),
    },
  });

  return {
    ok: true as const,
    positionX: input.positionX,
    positionY: input.positionY,
  };
}

export async function generateCharacterDesignTool(context: ToolContext) {
  const projectAccess = await verifyProjectAccess(context);
  if (!projectAccess.ok) {
    return projectAccess;
  }

  const parsed = characterDesignToolArgsSchema.safeParse(context.args);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Invalid payload for generate_character_design.',
      issues: formatValidationIssues(parsed.error.issues),
    };
  }

  const projectId = context.projectId;
  if (!projectId) {
    return {
      ok: false,
      message: 'Active project was not found for this user.',
    };
  }

  const styleCanonical = await ensureCanonicalStyleNode(context);
  if (!styleCanonical.ok) {
    return styleCanonical;
  }

  const optionsCount = parsed.data.optionsCount ?? 3;
  const replaceExisting = parsed.data.replaceExisting ?? true;

  const allCharacters = await prisma.characterNode.findMany({
    where: {
      projectId,
    },
    orderBy: {
      createdAt: 'asc',
    },
    select: {
      id: true,
      name: true,
      briefMarkdown: true,
      profileJson: true,
    },
  });

  if (!allCharacters.length) {
    return {
      ok: false,
      message:
        'No character nodes are available in the active project. Create/import characters first, then generate designs.',
    };
  }

  const requestedName = normalizeStringValue(parsed.data.characterName);
  const targets = requestedName
    ? allCharacters.filter(
        (item) =>
          item.name.trim().toLowerCase() === requestedName.toLowerCase(),
      )
    : allCharacters;

  if (requestedName && !targets.length) {
    return {
      ok: false,
      message: `Character "${requestedName}" was not found in the active project.`,
    };
  }

  const mode = requestedName ? ('single' as const) : ('all' as const);
  const characterNodeIds = targets.map((target) => target.id);
  const characterNames = targets.map((target) => target.name);
  const modeLabel = requestedName
    ? `for ${requestedName}`
    : 'for all characters';

  emitCharacterDesignStatusEvent({
    context,
    phase: 'started',
    message: `Generating character designs ${modeLabel}.`,
    projectId,
    mode,
    characterNodeIds,
    characterNames,
  });

  void Promise.resolve()
    .then(async () => {
      const results: Array<{
        characterNodeId: string;
        characterName: string;
        ok: boolean;
        message: string;
        generatedCount?: number;
        selectedCharacterDesignId?: string | null;
      }> = [];

      for (const target of targets) {
        try {
          const generated = await generateCharacterDesignForNode({
            characterNode: target,
            style: styleCanonical.style,
            optionsCount,
            replaceExisting,
          });

          if (!generated.ok) {
            results.push({
              characterNodeId: target.id,
              characterName: target.name,
              ok: false,
              message: generated.message,
            });
            continue;
          }

          results.push({
            characterNodeId: target.id,
            characterName: target.name,
            ok: true,
            message: generated.message,
            generatedCount: generated.generatedCount,
            selectedCharacterDesignId: generated.selectedCharacterDesignId,
          });
        } catch (error) {
          results.push({
            characterNodeId: target.id,
            characterName: target.name,
            ok: false,
            message:
              error instanceof Error
                ? error.message
                : 'Character design generation failed.',
          });
        }
      }

      const successCount = results.filter((item) => item.ok).length;
      const failedCount = results.length - successCount;

      const completionMessage =
        failedCount === 0
          ? `Character design generation finished ${modeLabel}.`
          : `Character design generation finished with ${successCount} success and ${failedCount} failure(s) ${modeLabel}.`;

      emitCharacterDesignStatusEvent({
        context,
        phase: 'completed',
        message: completionMessage,
        projectId,
        mode,
        characterNodeIds,
        characterNames,
        successCount,
        failedCount,
      });

      emitRuntimeEvent(context, {
        type: 'agent.project.changed',
        payload: {
          projectId,
          sourceTool: 'generate_character_design',
        },
      });
    })
    .catch((error) => {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Character design generation failed unexpectedly.';

      emitCharacterDesignStatusEvent({
        context,
        phase: 'completed',
        message: `Character design generation failed ${modeLabel}: ${errorMessage}`,
        projectId,
        mode,
        characterNodeIds,
        characterNames,
        successCount: 0,
        failedCount: characterNodeIds.length,
      });
    });

  return {
    ok: true,
    deferred: true,
    message: `Generating character designs ${modeLabel}. I will confirm once it's done.`,
    mode,
    optionsCount,
    replaceExisting,
    characterNodeIds,
    characterNames,
    startedAt: new Date().toISOString(),
  };
}

async function runStoryboardGenerationTool(
  context: ToolContext,
  options?: {
    sourceTool?: 'generate_storyboard' | 'update_storyboard';
    createIfMissingDefault?: boolean;
  },
) {
  const sourceTool = options?.sourceTool ?? 'generate_storyboard';
  const access = await verifyProjectAccess(context);
  if (!access.ok) {
    return access;
  }

  const parsedArgs = storyboardToolArgsSchema.safeParse(context.args);
  if (!parsedArgs.success) {
    return {
      ok: false,
      message: `Invalid payload for ${sourceTool}.`,
      issues: formatValidationIssues(parsedArgs.error.issues),
    };
  }

  const projectId = context.projectId;
  if (!projectId) {
    return {
      ok: false,
      message: 'This tool requires an active project context.',
    };
  }

  const projectGraph = await prisma.project.findFirst({
    where: {
      id: projectId,
      userId: context.userId,
    },
    select: {
      id: true,
      story: {
        select: {
          id: true,
          title: true,
          markdown: true,
        },
      },
      characterNodes: {
        select: {
          name: true,
          briefMarkdown: true,
          profileJson: true,
        },
        orderBy: {
          createdAt: 'asc',
        },
      },
      storyboardNodes: {
        select: {
          id: true,
          title: true,
          positionX: true,
          positionY: true,
        },
        orderBy: {
          updatedAt: 'desc',
        },
      },
    },
  });

  if (!projectGraph) {
    return {
      ok: false,
      message: 'Active project was not found for this user.',
    };
  }

  const storyTitle = normalizeStringValue(projectGraph.story?.title) || 'Story';
  const storyMarkdown = normalizeStringValue(projectGraph.story?.markdown);
  if (!storyMarkdown) {
    return {
      ok: false,
      message:
        'Storyboard generation requires story content. Import or write the story first.',
    };
  }

  const styleCanonical = await ensureCanonicalStyleNode(context);
  if (!styleCanonical.ok) {
    return styleCanonical;
  }

  const frameCountHint = parsedArgs.data.frameCount;
  const autoGenerate = parsedArgs.data.autoGenerate ?? true;
  const requestedStoryboardNodeId = normalizeStringValue(
    parsedArgs.data.storyboardNodeId,
  );
  const createIfMissing =
    parsedArgs.data.createIfMissing ?? options?.createIfMissingDefault ?? true;
  const providedFrames = normalizeStoryboardFramesFromUnknown(
    parsedArgs.data.shots,
  );

  const existingStoryboard = requestedStoryboardNodeId
    ? projectGraph.storyboardNodes.find(
        (node) => node.id === requestedStoryboardNodeId,
      )
    : (projectGraph.storyboardNodes[0] ?? null);

  if (requestedStoryboardNodeId && !existingStoryboard) {
    return {
      ok: false,
      message:
        'Requested storyboard node was not found in the active project. Use an existing storyboardNodeId or omit it to target the latest storyboard node.',
      requestedStoryboardNodeId,
    };
  }

  if (!existingStoryboard && !createIfMissing) {
    return {
      ok: false,
      message:
        'No storyboard node exists to update in this project. Create one first or set createIfMissing=true.',
    };
  }

  const title =
    normalizeStringValue(parsedArgs.data.title) ||
    existingStoryboard?.title ||
    `${storyTitle} Storyboard`;

  const storyboard = existingStoryboard
    ? await prisma.storyboardNode.update({
        where: {
          id: existingStoryboard.id,
        },
        data: {
          title,
          ...(providedFrames.length
            ? { shotsJson: JSON.stringify(providedFrames) }
            : {}),
        },
      })
    : await (async () => {
        const [position] = await allocateNodePositions(projectId, 1);
        return prisma.storyboardNode.create({
          data: {
            projectId,
            title,
            shotsJson: JSON.stringify(providedFrames),
            positionX: position?.x ?? 1320,
            positionY: position?.y ?? 120,
          },
        });
      })();

  const mutationMode = existingStoryboard ? 'updated' : 'created';

  if (!autoGenerate && providedFrames.length) {
    emitRuntimeEvent(context, {
      type: 'agent.project.changed',
      payload: {
        projectId,
        sourceTool,
      },
    });

    return {
      ok: true,
      storyboard,
      generated: false,
      mutationMode,
      message:
        mutationMode === 'updated'
          ? 'Storyboard node updated from provided frames.'
          : 'Storyboard node created from provided frames.',
    };
  }

  if (autoGenerate) {
    await prisma.storyboardNode.update({
      where: {
        id: storyboard.id,
      },
      data: {
        title,
        shotsJson: JSON.stringify([]),
      },
    });

    emitRuntimeEvent(context, {
      type: 'agent.project.changed',
      payload: {
        projectId,
        sourceTool,
      },
    });
  }

  const characterDesignReferences = collectStoryboardCharacterDesignReferences(
    projectGraph.characterNodes,
  );

  const characters = characterDesignReferences.map((reference) => ({
    name: reference.characterName,
    briefMarkdown: reference.briefMarkdown,
    description: reference.description,
    designCue: reference.selectedDesignPrompt || reference.profileStyle,
  }));

  emitRuntimeEvent(context, {
    type: 'agent.status',
    payload: {
      phase: 'started',
      sourceTool,
      projectId,
      storyboardNodeId: storyboard.id,
      generationPhase: 'descriptions',
      message:
        mutationMode === 'updated'
          ? 'Updating storyboard frames from story and style guide.'
          : 'Generating storyboard frames from story and style guide.',
    },
  });

  void Promise.resolve()
    .then(async () => {
      const generatedFrames = await deriveStoryboardFramesWithSubAgent({
        storyTitle,
        storyMarkdown,
        frameCountHint,
        style: styleCanonical.style,
        characters,
      });

      const nextFrames = generatedFrames.length
        ? generatedFrames
        : providedFrames;

      if (!nextFrames.length) {
        throw new Error('Storyboard generation returned no usable frames.');
      }

      const framesWithPendingImages: StoryboardFrame[] = nextFrames.map(
        (frame) => ({
          ...frame,
          imageStatus: frame.imageUrl ? 'ready' : 'pending',
        }),
      );

      let streamedFrames: StoryboardFrame[] = [];
      for (
        let chunkStart = 0;
        chunkStart < framesWithPendingImages.length;
        chunkStart += STORYBOARD_DESCRIPTION_STREAM_CHUNK_SIZE
      ) {
        const chunk = framesWithPendingImages.slice(
          chunkStart,
          chunkStart + STORYBOARD_DESCRIPTION_STREAM_CHUNK_SIZE,
        );
        streamedFrames = [...streamedFrames, ...chunk];

        await prisma.storyboardNode.update({
          where: {
            id: storyboard.id,
          },
          data: {
            title,
            shotsJson: JSON.stringify(streamedFrames),
          },
        });

        emitRuntimeEvent(context, {
          type: 'agent.status',
          payload: {
            phase: 'descriptions_progress',
            sourceTool,
            projectId,
            storyboardNodeId: storyboard.id,
            generationPhase: 'descriptions',
            totalFrames: framesWithPendingImages.length,
            completedFrames: streamedFrames.length,
            message: `Storyboard descriptions: ${streamedFrames.length}/${framesWithPendingImages.length}`,
          },
        });

        emitRuntimeEvent(context, {
          type: 'agent.project.changed',
          payload: {
            projectId,
            sourceTool,
          },
        });
      }

      const pendingImageCount = framesWithPendingImages.filter(
        (frame) => !frame.imageUrl,
      ).length;

      emitRuntimeEvent(context, {
        type: 'agent.status',
        payload: {
          phase: 'descriptions_completed',
          sourceTool,
          projectId,
          storyboardNodeId: storyboard.id,
          generationPhase: pendingImageCount > 0 ? 'images' : 'completed',
          frameCount: framesWithPendingImages.length,
          pendingImageCount,
          message:
            pendingImageCount > 0
              ? `Storyboard descriptions ready. Generating ${pendingImageCount} frame image(s) in chunks of ${STORYBOARD_IMAGE_CHUNK_SIZE}.`
              : 'Storyboard descriptions ready. No image generation needed.',
        },
      });

      emitRuntimeEvent(context, {
        type: 'agent.project.changed',
        payload: {
          projectId,
          sourceTool,
        },
      });

      const imageFrames = [...streamedFrames];
      let imageSuccessCount = 0;
      let imageFailedCount = 0;

      const pendingIndexes = imageFrames
        .map((frame, index) => ({ frame, index }))
        .filter(({ frame }) => !frame.imageUrl)
        .map(({ index }) => index);

      if (pendingIndexes.length) {
        emitRuntimeEvent(context, {
          type: 'agent.status',
          payload: {
            phase: 'images_started',
            sourceTool,
            projectId,
            storyboardNodeId: storyboard.id,
            generationPhase: 'images',
            totalImages: pendingIndexes.length,
            chunkSize: STORYBOARD_IMAGE_CHUNK_SIZE,
            message: `Generating storyboard images ${pendingIndexes.length} total, ${STORYBOARD_IMAGE_CHUNK_SIZE} at a time.`,
          },
        });
      }

      for (
        let chunkStart = 0;
        chunkStart < pendingIndexes.length;
        chunkStart += STORYBOARD_IMAGE_CHUNK_SIZE
      ) {
        const chunkIndexes = pendingIndexes.slice(
          chunkStart,
          chunkStart + STORYBOARD_IMAGE_CHUNK_SIZE,
        );

        await Promise.all(
          chunkIndexes.map(async (index) => {
            const frame = imageFrames[index];
            if (!frame || frame.imageUrl) {
              return;
            }

            const result = await generateStoryboardFrameImageWithRetry({
              storyTitle,
              frame,
              style: styleCanonical.style,
              characterDesignReferences,
              maxAttempts: STORYBOARD_IMAGE_RETRY_ATTEMPTS,
            });

            if (result.ok) {
              imageFrames[index] = {
                ...frame,
                imageUrl: result.imageUrl,
                imageStatus: 'ready',
              };
              imageSuccessCount += 1;
            } else {
              imageFrames[index] = {
                ...frame,
                imageStatus: 'failed',
              };
              imageFailedCount += 1;
            }
          }),
        );

        await prisma.storyboardNode.update({
          where: {
            id: storyboard.id,
          },
          data: {
            shotsJson: JSON.stringify(imageFrames),
          },
        });

        emitRuntimeEvent(context, {
          type: 'agent.status',
          payload: {
            phase: 'images_progress',
            sourceTool,
            projectId,
            storyboardNodeId: storyboard.id,
            generationPhase: 'images',
            totalImages: pendingIndexes.length,
            completedImages: imageSuccessCount + imageFailedCount,
            successImages: imageSuccessCount,
            failedImages: imageFailedCount,
            message: `Storyboard image progress: ${imageSuccessCount + imageFailedCount}/${pendingIndexes.length}`,
          },
        });

        emitRuntimeEvent(context, {
          type: 'agent.project.changed',
          payload: {
            projectId,
            sourceTool,
          },
        });
      }

      emitRuntimeEvent(context, {
        type: 'agent.status',
        payload: {
          phase: 'completed',
          sourceTool,
          projectId,
          storyboardNodeId: storyboard.id,
          generationPhase: 'completed',
          message:
            imageFailedCount > 0
              ? `Storyboard completed with ${imageSuccessCount} image(s) and ${imageFailedCount} failed image generation(s).`
              : `Storyboard generation completed with ${nextFrames.length} frame(s) and images ready.`,
        },
      });

      emitRuntimeEvent(context, {
        type: 'agent.project.changed',
        payload: {
          projectId,
          sourceTool,
        },
      });
    })
    .catch((error) => {
      emitRuntimeEvent(context, {
        type: 'agent.status',
        payload: {
          phase: 'completed',
          sourceTool,
          projectId,
          message:
            error instanceof Error
              ? `Storyboard generation failed: ${error.message}`
              : 'Storyboard generation failed.',
        },
      });
    });

  return {
    ok: true,
    deferred: true,
    storyboard,
    mutationMode,
    message:
      mutationMode === 'updated'
        ? 'Storyboard node updated. Generating detailed frames from story and style guide now.'
        : 'Storyboard node created. Generating detailed frames from story and style guide now.',
    frameCountHint,
    startedAt: new Date().toISOString(),
  };
}

export async function generateStoryboardTool(context: ToolContext) {
  return runStoryboardGenerationTool(context, {
    sourceTool: 'generate_storyboard',
    createIfMissingDefault: true,
  });
}

export async function updateStoryboardTool(context: ToolContext) {
  return runStoryboardGenerationTool(context, {
    sourceTool: 'update_storyboard',
    createIfMissingDefault: false,
  });
}
