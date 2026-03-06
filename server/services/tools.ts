import { prisma } from '../lib/db';

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
  if (!context.projectId) {
    throw new Error('projectId is required for character brief generation');
  }

  const name = String(context.args.name ?? 'New Character');
  const brief = String(
    context.args.brief ?? 'Character brief generated from story context.',
  );

  const node = await prisma.characterNode.create({
    data: {
      projectId: context.projectId,
      name,
      briefMarkdown: brief,
      inspirationUrls: [],
    },
  });

  return { ok: true, node };
}

export async function generateCharacterInspirationTool(context: ToolContext) {
  if (!context.projectId) {
    throw new Error('projectId is required for inspiration generation');
  }

  const styleNode = await prisma.styleNode.create({
    data: {
      projectId: context.projectId,
      name: String(context.args.styleName ?? 'Default Style'),
      description: String(
        context.args.description ??
          'Generated style reference from story and character brief.',
      ),
    },
  });

  return { ok: true, styleNode };
}

export async function generateStoryboardTool(context: ToolContext) {
  if (!context.projectId) {
    throw new Error('projectId is required for storyboard generation');
  }

  const storyboard = await prisma.storyboardNode.create({
    data: {
      projectId: context.projectId,
      title: String(context.args.title ?? 'Storyboard Draft'),
      shotsJson: JSON.stringify(context.args.shots ?? []),
    },
  });

  return { ok: true, storyboard };
}
