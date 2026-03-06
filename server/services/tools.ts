import { prisma } from '../lib/db';

type ToolContext = {
  userId: string;
  projectId?: string;
  args: Record<string, unknown>;
};

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

export async function importStoryMarkdownTool(context: ToolContext) {
  return {
    ok: true,
    message:
      'Use /api/projects/:id/story/import to import markdown from Google Docs.',
    received: context.args,
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
