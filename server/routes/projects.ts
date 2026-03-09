import { Hono } from 'hono';
import { z } from 'zod';
import { getSessionFromHeaders } from '../lib/auth';
import { prisma } from '../lib/db';
import {
  createProjectForUser,
  getProjectForUser,
  listProjectsForUser,
} from '../services/project-service';
import {
  regenerateStoryboardFrameImageForUser,
  regenerateCharacterDesignOptionsForUser,
  selectCharacterDesignOptionForUser,
  updateCharacterDesignNodePositionForUser,
} from '../services/tools';

const createProjectSchema = z.object({
  name: z.string().min(1).max(120),
});

const updateCharacterNodeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).default(''),
  traitsText: z.string().max(12000).default(''),
});

const updateStyleNodeSchema = z.object({
  name: z.string().trim().min(1).max(120).default('Project Style Guide'),
  writingStyle: z.string().trim().max(8000).default(''),
  characterStyle: z.string().trim().max(8000).default(''),
  artStyle: z.string().trim().max(8000).default(''),
  storytellingPacing: z.string().trim().max(8000).default(''),
  extrasText: z.string().max(12000).default(''),
});

const updateNodePositionSchema = z.object({
  positionX: z.number().finite(),
  positionY: z.number().finite(),
});

const storyboardFrameUpdateSchema = z.object({
  frameNumber: z.coerce.number().int().min(1),
  description: z.string().trim().max(8000).default(''),
  cameraAngle: z.string().trim().max(300).default(''),
  cameraMovement: z.string().trim().max(400).default(''),
  characters: z
    .array(
      z.object({
        characterName: z.string().trim().min(1).max(120),
        action: z.string().trim().min(1).max(1200),
        designCue: z.string().trim().max(1200).default(''),
      }),
    )
    .max(20)
    .default([]),
  durationSeconds: z.coerce.number().min(0.1).max(120).default(3),
  annotations: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
  imageStatus: z.enum(['pending', 'ready', 'failed']).optional(),
  imageUrl: z.string().trim().max(2048).optional(),
});

const updateStoryboardNodeSchema = z.object({
  title: z.string().trim().min(1).max(240),
  frames: z.array(storyboardFrameUpdateSchema).max(24).default([]),
});

const regenerateStoryboardFrameImageSchema = z.object({
  frameNumber: z.coerce.number().int().min(1),
});

const regenerateCharacterDesignSchema = z.object({
  optionsCount: z.coerce.number().int().min(1).max(4).optional(),
});

const selectCharacterDesignSchema = z.object({
  optionId: z.string().trim().min(1),
});

export const projectsRouter = new Hono();

async function requireProjectAccess(userId: string, projectId: string) {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      userId,
    },
    select: {
      id: true,
    },
  });

  return project;
}

function parseTraitsText(traitsText: string) {
  const canonical: Record<string, string> = {};
  const attributes: Record<string, string> = {};
  const notesFallback: string[] = [];

  const keyMap: Record<string, string> = {
    behavior: 'behavior',
    behaviour: 'behavior',
    style: 'style',
    personality: 'personality',
    goals: 'goals',
    notes: 'notes',
  };

  for (const rawLine of traitsText.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const match = /^([A-Za-z][A-Za-z\s_-]{1,40}):\s*(.+)$/.exec(line);
    if (!match) {
      notesFallback.push(line);
      continue;
    }

    const key = match[1].trim().toLowerCase().replace(/\s+/g, '_');
    const value = match[2].trim();
    if (!value) {
      continue;
    }

    const canonicalKey = keyMap[key];
    if (canonicalKey) {
      canonical[canonicalKey] = value;
      continue;
    }

    attributes[match[1].trim()] = value;
  }

  if (notesFallback.length) {
    const nextNotes = notesFallback.join(' ');
    canonical.notes = canonical.notes
      ? `${canonical.notes} ${nextNotes}`
      : nextNotes;
  }

  return {
    canonical,
    attributes,
  };
}

function buildCharacterBriefMarkdown(input: {
  description: string;
  behavior?: string;
  style?: string;
  personality?: string;
  goals?: string;
  notes?: string;
}) {
  const lines: string[] = [];

  if (input.description.trim()) {
    lines.push(input.description.trim());
  }

  const traitLines = [
    ['Behavior', input.behavior],
    ['Style', input.style],
    ['Personality', input.personality],
    ['Goals', input.goals],
    ['Notes', input.notes],
  ]
    .filter(([, value]) => typeof value === 'string' && value.trim())
    .map(([label, value]) => `- **${label}:** ${String(value).trim()}`);

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

function parseStyleExtrasText(extrasText: string) {
  const extras: Record<string, string> = {};

  for (const rawLine of extrasText.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const match = /^([A-Za-z][A-Za-z\s_-]{1,60}):\s*(.+)$/.exec(line);
    if (!match) {
      continue;
    }

    const key = match[1].trim();
    const value = match[2].trim();
    if (!key || !value) {
      continue;
    }

    extras[key] = value;
  }

  return extras;
}

function buildStyleDescription(input: {
  writingStyle: string;
  characterStyle: string;
  artStyle: string;
  storytellingPacing: string;
  extras: Record<string, string>;
}) {
  const lines: string[] = [
    `Writing Style: ${input.writingStyle || 'Not specified yet.'}`,
    `Character Style: ${input.characterStyle || 'Not specified yet.'}`,
    `Art Style: ${input.artStyle || 'Not specified yet.'}`,
    `Storytelling Pacing: ${input.storytellingPacing || 'Not specified yet.'}`,
  ];

  const extrasEntries = Object.entries(input.extras);
  if (extrasEntries.length) {
    lines.push('');
    lines.push('Additional Style Direction:');
    for (const [key, value] of extrasEntries) {
      lines.push(`- ${key}: ${value}`);
    }
  }

  return lines.join('\n');
}

projectsRouter.get('/api/projects', async (c) => {
  const session = await getSessionFromHeaders(c.req.raw.headers);
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const projects = await listProjectsForUser(session.user.id);
  return c.json({ projects });
});

projectsRouter.post('/api/projects', async (c) => {
  const session = await getSessionFromHeaders(c.req.raw.headers);
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const body = await c.req.json();
  const data = createProjectSchema.parse(body);
  const project = await createProjectForUser(session.user.id, data.name);

  return c.json({ project });
});

projectsRouter.get('/api/projects/:projectId', async (c) => {
  const session = await getSessionFromHeaders(c.req.raw.headers);
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const projectId = c.req.param('projectId');
  const project = await getProjectForUser(session.user.id, projectId);

  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  return c.json({ project });
});

projectsRouter.delete('/api/projects/:projectId/story', async (c) => {
  const session = await getSessionFromHeaders(c.req.raw.headers);
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const projectId = c.req.param('projectId');
  const project = await requireProjectAccess(session.user.id, projectId);
  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  const deleted = await prisma.story.deleteMany({
    where: { projectId },
  });

  return c.json({ ok: true, nodeType: 'story', deletedCount: deleted.count });
});

projectsRouter.delete(
  '/api/projects/:projectId/character-nodes/:nodeId',
  async (c) => {
    const session = await getSessionFromHeaders(c.req.raw.headers);
    if (!session) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const projectId = c.req.param('projectId');
    const nodeId = c.req.param('nodeId');
    const project = await requireProjectAccess(session.user.id, projectId);
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    const deleted = await prisma.characterNode.deleteMany({
      where: {
        id: nodeId,
        projectId,
      },
    });

    return c.json({
      ok: true,
      nodeType: 'character',
      deletedCount: deleted.count,
    });
  },
);

projectsRouter.patch(
  '/api/projects/:projectId/character-nodes/:nodeId',
  async (c) => {
    const session = await getSessionFromHeaders(c.req.raw.headers);
    if (!session) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const projectId = c.req.param('projectId');
    const nodeId = c.req.param('nodeId');
    const project = await requireProjectAccess(session.user.id, projectId);
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    const body = await c.req.json();
    const payload = updateCharacterNodeSchema.parse(body);

    const existing = await prisma.characterNode.findFirst({
      where: {
        id: nodeId,
        projectId,
      },
      select: {
        id: true,
        profileJson: true,
      },
    });

    if (!existing) {
      return c.json({ error: 'Character node not found' }, 404);
    }

    const existingProfile = (() => {
      if (!existing.profileJson) {
        return {} as Record<string, unknown>;
      }

      try {
        const parsed = JSON.parse(existing.profileJson);
        return parsed && typeof parsed === 'object'
          ? (parsed as Record<string, unknown>)
          : ({} as Record<string, unknown>);
      } catch {
        return {} as Record<string, unknown>;
      }
    })();

    const parsedTraits = parseTraitsText(payload.traitsText);

    const nextProfile: Record<string, unknown> = {
      ...existingProfile,
      description: payload.description,
      ...(parsedTraits.canonical.behavior
        ? { behavior: parsedTraits.canonical.behavior }
        : {}),
      ...(parsedTraits.canonical.style
        ? { style: parsedTraits.canonical.style }
        : {}),
      ...(parsedTraits.canonical.personality
        ? { personality: parsedTraits.canonical.personality }
        : {}),
      ...(parsedTraits.canonical.goals
        ? { goals: parsedTraits.canonical.goals }
        : {}),
      ...(parsedTraits.canonical.notes
        ? { notes: parsedTraits.canonical.notes }
        : {}),
      ...(Object.keys(parsedTraits.attributes).length
        ? { attributes: parsedTraits.attributes }
        : {}),
    };

    const briefMarkdown = buildCharacterBriefMarkdown({
      description: payload.description,
      behavior:
        typeof nextProfile.behavior === 'string' ? nextProfile.behavior : '',
      style: typeof nextProfile.style === 'string' ? nextProfile.style : '',
      personality:
        typeof nextProfile.personality === 'string'
          ? nextProfile.personality
          : '',
      goals: typeof nextProfile.goals === 'string' ? nextProfile.goals : '',
      notes: typeof nextProfile.notes === 'string' ? nextProfile.notes : '',
    });

    const node = await prisma.characterNode.update({
      where: {
        id: existing.id,
      },
      data: {
        name: payload.name,
        briefMarkdown,
        profileJson: JSON.stringify(nextProfile),
      },
    });

    return c.json({ ok: true, node });
  },
);

projectsRouter.post(
  '/api/projects/:projectId/character-nodes/:nodeId/designs/regenerate',
  async (c) => {
    const session = await getSessionFromHeaders(c.req.raw.headers);
    if (!session) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const projectId = c.req.param('projectId');
    const nodeId = c.req.param('nodeId');
    const project = await requireProjectAccess(session.user.id, projectId);
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    const body = await c.req.json().catch(() => ({}));
    const payload = regenerateCharacterDesignSchema.parse(body);

    const result = await regenerateCharacterDesignOptionsForUser({
      userId: session.user.id,
      projectId,
      characterNodeId: nodeId,
      optionsCount: payload.optionsCount,
    });

    if (!result.ok) {
      return c.json({ error: result.message }, 400);
    }

    return c.json({
      ok: true,
      message: result.message,
      node: result.node,
      generatedCount: result.generatedCount,
      selectedCharacterDesignId: result.selectedCharacterDesignId,
    });
  },
);

projectsRouter.patch(
  '/api/projects/:projectId/character-nodes/:nodeId/design-selection',
  async (c) => {
    const session = await getSessionFromHeaders(c.req.raw.headers);
    if (!session) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const projectId = c.req.param('projectId');
    const nodeId = c.req.param('nodeId');
    const project = await requireProjectAccess(session.user.id, projectId);
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    const body = await c.req.json();
    const payload = selectCharacterDesignSchema.parse(body);

    const result = await selectCharacterDesignOptionForUser({
      userId: session.user.id,
      projectId,
      characterNodeId: nodeId,
      optionId: payload.optionId,
    });

    if (!result.ok) {
      return c.json({ error: result.message }, 400);
    }

    return c.json({
      ok: true,
      message: result.message,
      node: result.node,
    });
  },
);

projectsRouter.patch('/api/projects/:projectId/story/position', async (c) => {
  const session = await getSessionFromHeaders(c.req.raw.headers);
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const projectId = c.req.param('projectId');
  const project = await requireProjectAccess(session.user.id, projectId);
  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  const body = await c.req.json();
  const payload = updateNodePositionSchema.parse(body);

  const updated = await prisma.story.updateMany({
    where: { projectId },
    data: {
      positionX: payload.positionX,
      positionY: payload.positionY,
    },
  });

  if (!updated.count) {
    return c.json({ error: 'Story node not found' }, 404);
  }

  return c.json({
    ok: true,
    nodeType: 'story',
    positionX: payload.positionX,
    positionY: payload.positionY,
  });
});

projectsRouter.patch(
  '/api/projects/:projectId/style-nodes/:nodeId',
  async (c) => {
    const session = await getSessionFromHeaders(c.req.raw.headers);
    if (!session) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const projectId = c.req.param('projectId');
    const nodeId = c.req.param('nodeId');
    const project = await requireProjectAccess(session.user.id, projectId);
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    const body = await c.req.json();
    const payload = updateStyleNodeSchema.parse(body);

    const existing = await prisma.styleNode.findFirst({
      where: {
        id: nodeId,
        projectId,
      },
      select: {
        id: true,
      },
    });

    if (!existing) {
      return c.json({ error: 'Style node not found' }, 404);
    }

    const extras = parseStyleExtrasText(payload.extrasText);
    const description = buildStyleDescription({
      writingStyle: payload.writingStyle,
      characterStyle: payload.characterStyle,
      artStyle: payload.artStyle,
      storytellingPacing: payload.storytellingPacing,
      extras,
    });

    const node = await prisma.styleNode.update({
      where: {
        id: existing.id,
      },
      data: {
        name: payload.name,
        writingStyle: payload.writingStyle,
        characterStyle: payload.characterStyle,
        artStyle: payload.artStyle,
        storytellingPacing: payload.storytellingPacing,
        extrasJson: JSON.stringify(extras),
        description,
      },
    });

    return c.json({ ok: true, node });
  },
);

projectsRouter.patch(
  '/api/projects/:projectId/character-nodes/:nodeId/position',
  async (c) => {
    const session = await getSessionFromHeaders(c.req.raw.headers);
    if (!session) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const projectId = c.req.param('projectId');
    const nodeId = c.req.param('nodeId');
    const project = await requireProjectAccess(session.user.id, projectId);
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    const body = await c.req.json();
    const payload = updateNodePositionSchema.parse(body);

    const updated = await prisma.characterNode.updateMany({
      where: {
        id: nodeId,
        projectId,
      },
      data: {
        positionX: payload.positionX,
        positionY: payload.positionY,
      },
    });

    if (!updated.count) {
      return c.json({ error: 'Character node not found' }, 404);
    }

    return c.json({
      ok: true,
      nodeType: 'character',
      nodeId,
      positionX: payload.positionX,
      positionY: payload.positionY,
    });
  },
);

projectsRouter.patch(
  '/api/projects/:projectId/character-nodes/:nodeId/design-position',
  async (c) => {
    const session = await getSessionFromHeaders(c.req.raw.headers);
    if (!session) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const projectId = c.req.param('projectId');
    const nodeId = c.req.param('nodeId');
    const project = await requireProjectAccess(session.user.id, projectId);
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    const body = await c.req.json();
    const payload = updateNodePositionSchema.parse(body);

    const result = await updateCharacterDesignNodePositionForUser({
      userId: session.user.id,
      projectId,
      characterNodeId: nodeId,
      positionX: payload.positionX,
      positionY: payload.positionY,
    });

    if (!result.ok) {
      return c.json({ error: result.message }, 400);
    }

    return c.json({
      ok: true,
      nodeType: 'character-design',
      nodeId,
      positionX: payload.positionX,
      positionY: payload.positionY,
    });
  },
);

projectsRouter.patch(
  '/api/projects/:projectId/style-nodes/:nodeId/position',
  async (c) => {
    const session = await getSessionFromHeaders(c.req.raw.headers);
    if (!session) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const projectId = c.req.param('projectId');
    const nodeId = c.req.param('nodeId');
    const project = await requireProjectAccess(session.user.id, projectId);
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    const body = await c.req.json();
    const payload = updateNodePositionSchema.parse(body);

    const updated = await prisma.styleNode.updateMany({
      where: {
        id: nodeId,
        projectId,
      },
      data: {
        positionX: payload.positionX,
        positionY: payload.positionY,
      },
    });

    if (!updated.count) {
      return c.json({ error: 'Style node not found' }, 404);
    }

    return c.json({
      ok: true,
      nodeType: 'style',
      nodeId,
      positionX: payload.positionX,
      positionY: payload.positionY,
    });
  },
);

projectsRouter.patch(
  '/api/projects/:projectId/storyboard-nodes/:nodeId/position',
  async (c) => {
    const session = await getSessionFromHeaders(c.req.raw.headers);
    if (!session) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const projectId = c.req.param('projectId');
    const nodeId = c.req.param('nodeId');
    const project = await requireProjectAccess(session.user.id, projectId);
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    const body = await c.req.json();
    const payload = updateNodePositionSchema.parse(body);

    const updated = await prisma.storyboardNode.updateMany({
      where: {
        id: nodeId,
        projectId,
      },
      data: {
        positionX: payload.positionX,
        positionY: payload.positionY,
      },
    });

    if (!updated.count) {
      return c.json({ error: 'Storyboard node not found' }, 404);
    }

    return c.json({
      ok: true,
      nodeType: 'storyboard',
      nodeId,
      positionX: payload.positionX,
      positionY: payload.positionY,
    });
  },
);

projectsRouter.patch(
  '/api/projects/:projectId/storyboard-nodes/:nodeId',
  async (c) => {
    const session = await getSessionFromHeaders(c.req.raw.headers);
    if (!session) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const projectId = c.req.param('projectId');
    const nodeId = c.req.param('nodeId');
    const project = await requireProjectAccess(session.user.id, projectId);
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    const body = await c.req.json();
    const payload = updateStoryboardNodeSchema.parse(body);
    const normalizedFrames = payload.frames
      .slice(0, 24)
      .map((frame, index) => ({
        ...frame,
        frameNumber: index + 1,
      }));

    const updated = await prisma.storyboardNode.updateMany({
      where: {
        id: nodeId,
        projectId,
      },
      data: {
        title: payload.title,
        shotsJson: JSON.stringify(normalizedFrames),
      },
    });

    if (!updated.count) {
      return c.json({ error: 'Storyboard node not found' }, 404);
    }

    const node = await prisma.storyboardNode.findFirst({
      where: {
        id: nodeId,
        projectId,
      },
    });

    return c.json({ ok: true, node });
  },
);

projectsRouter.post(
  '/api/projects/:projectId/storyboard-nodes/:nodeId/regenerate-image',
  async (c) => {
    const session = await getSessionFromHeaders(c.req.raw.headers);
    if (!session) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const projectId = c.req.param('projectId');
    const nodeId = c.req.param('nodeId');
    const project = await requireProjectAccess(session.user.id, projectId);
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    const body = await c.req.json();
    const payload = regenerateStoryboardFrameImageSchema.parse(body);

    const result = await regenerateStoryboardFrameImageForUser({
      userId: session.user.id,
      projectId,
      storyboardNodeId: nodeId,
      frameNumber: payload.frameNumber,
    });

    if (!result.ok) {
      const errorNode = 'node' in result ? result.node : undefined;
      const errorFrameNumber =
        'frameNumber' in result ? result.frameNumber : payload.frameNumber;
      const errorAttempts = 'attempts' in result ? result.attempts : undefined;

      return c.json(
        {
          ok: false,
          error: result.message || 'Failed to regenerate storyboard image.',
          node: errorNode,
          frameNumber: errorFrameNumber,
          attempts: errorAttempts,
        },
        500,
      );
    }

    const imageUrl = 'imageUrl' in result ? result.imageUrl : undefined;

    return c.json({
      ok: true,
      node: result.node,
      frameNumber: result.frameNumber,
      imageUrl,
      attempts: result.attempts,
    });
  },
);

projectsRouter.delete(
  '/api/projects/:projectId/style-nodes/:nodeId',
  async (c) => {
    const session = await getSessionFromHeaders(c.req.raw.headers);
    if (!session) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const projectId = c.req.param('projectId');
    const nodeId = c.req.param('nodeId');
    const project = await requireProjectAccess(session.user.id, projectId);
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    const deleted = await prisma.styleNode.deleteMany({
      where: {
        id: nodeId,
        projectId,
      },
    });

    return c.json({ ok: true, nodeType: 'style', deletedCount: deleted.count });
  },
);

projectsRouter.delete(
  '/api/projects/:projectId/storyboard-nodes/:nodeId',
  async (c) => {
    const session = await getSessionFromHeaders(c.req.raw.headers);
    if (!session) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const projectId = c.req.param('projectId');
    const nodeId = c.req.param('nodeId');
    const project = await requireProjectAccess(session.user.id, projectId);
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    const deleted = await prisma.storyboardNode.deleteMany({
      where: {
        id: nodeId,
        projectId,
      },
    });

    return c.json({
      ok: true,
      nodeType: 'storyboard',
      deletedCount: deleted.count,
    });
  },
);

const saveReferenceImagesSchema = z.object({
  imageUrls: z.array(z.string().url()).min(1).max(20),
});

projectsRouter.post(
  '/api/projects/:projectId/character-nodes/:nodeId/references',
  async (c) => {
    const session = await getSessionFromHeaders(c.req.raw.headers);
    if (!session) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const projectId = c.req.param('projectId');
    const nodeId = c.req.param('nodeId');
    const project = await requireProjectAccess(session.user.id, projectId);
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    const body = await c.req.json();
    const { imageUrls } = saveReferenceImagesSchema.parse(body);

    const node = await prisma.characterNode.findFirst({
      where: { id: nodeId, projectId },
      select: { id: true },
    });
    if (!node) {
      return c.json({ error: 'Character node not found' }, 404);
    }

    const updated = await prisma.characterNode.update({
      where: { id: nodeId },
      data: { inspirationUrls: imageUrls },
      select: { id: true, inspirationUrls: true },
    });

    return c.json({
      ok: true,
      nodeId: updated.id,
      inspirationUrls: updated.inspirationUrls,
    });
  },
);

projectsRouter.post(
  '/api/projects/:projectId/storyboard-nodes/:nodeId/references',
  async (c) => {
    const session = await getSessionFromHeaders(c.req.raw.headers);
    if (!session) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const projectId = c.req.param('projectId');
    const nodeId = c.req.param('nodeId');
    const project = await requireProjectAccess(session.user.id, projectId);
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    const body = await c.req.json();
    const { imageUrls } = saveReferenceImagesSchema.parse(body);

    const node = await prisma.storyboardNode.findFirst({
      where: { id: nodeId, projectId },
      select: { id: true },
    });
    if (!node) {
      return c.json({ error: 'Storyboard node not found' }, 404);
    }

    const updated = await prisma.storyboardNode.update({
      where: { id: nodeId },
      data: { referenceImageUrls: imageUrls },
      select: { id: true, referenceImageUrls: true },
    });

    return c.json({
      ok: true,
      nodeId: updated.id,
      referenceImageUrls: updated.referenceImageUrls,
    });
  },
);
