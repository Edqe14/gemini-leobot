import { GoogleGenAI, type GoogleGenAIOptions } from '@google/genai';
import { prisma } from '../lib/db';
import { env } from '../lib/env';
import { z } from 'zod';
import { allocateNodePositions } from './node-position';

type ToolContext = {
  userId: string;
  projectId?: string;
  args: Record<string, unknown>;
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
    drafts.length,
  );

  for (const [index, draft] of drafts.entries()) {
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
  const message = derivedFromStory
    ? createdCount === 1
      ? 'Derived 1 character from the active story node and created its brief node.'
      : `Derived ${createdCount} characters from the active story node and created their brief nodes.`
    : createdCount === 1
      ? 'Created 1 character brief node for the active project.'
      : `Created ${createdCount} character brief nodes for the active project.`;

  return {
    ok: true,
    message,
    storyContext,
    createdCount,
    createdNodes,
    relatedNodes: {
      characterNodeIds:
        projectGraph?.characterNodes.map((node) => node.id) ??
        createdNodes.map((node) => node.id),
    },
  };
}

export async function generateCharacterInspirationTool(context: ToolContext) {
  if (!context.projectId) {
    throw new Error('projectId is required for inspiration generation');
  }

  const [position] = await allocateNodePositions(context.projectId, 1);

  const styleNode = await prisma.styleNode.create({
    data: {
      projectId: context.projectId,
      name: String(context.args.styleName ?? 'Default Style'),
      description: String(
        context.args.description ??
          'Generated style reference from story and character brief.',
      ),
      positionX: position?.x ?? 980,
      positionY: position?.y ?? 120,
    },
  });

  return { ok: true, styleNode };
}

export async function generateStoryboardTool(context: ToolContext) {
  if (!context.projectId) {
    throw new Error('projectId is required for storyboard generation');
  }

  const [position] = await allocateNodePositions(context.projectId, 1);

  const storyboard = await prisma.storyboardNode.create({
    data: {
      projectId: context.projectId,
      title: String(context.args.title ?? 'Storyboard Draft'),
      shotsJson: JSON.stringify(context.args.shots ?? []),
      positionX: position?.x ?? 1320,
      positionY: position?.y ?? 120,
    },
  });

  return { ok: true, storyboard };
}
