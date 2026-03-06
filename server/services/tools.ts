import { Type, type FunctionDeclaration } from '@google/genai';
import { prisma } from '../lib/db';

type ToolContext = {
  userId: string;
  projectId?: string;
  args: Record<string, unknown>;
};

const LIST_PROJECTS_DECLARATION: FunctionDeclaration = {
  name: 'list_projects',
  description:
    'List all projects for the authenticated user, including recency and node/story summary metadata.',
};

const IMPORT_STORY_MARKDOWN_DECLARATION: FunctionDeclaration = {
  name: 'import_story_markdown',
  description:
    'Import or sync story markdown content into the active project. Use when user asks to import story text or Google Docs content.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      markdown: {
        type: Type.STRING,
        description:
          'Optional markdown content to import. If omitted, backend may use project import flow details.',
      },
      sourceUrl: {
        type: Type.STRING,
        description:
          'Optional Google Docs or source URL that contains the story markdown.',
      },
    },
  },
};

const GENERATE_CHARACTER_BRIEF_DECLARATION: FunctionDeclaration = {
  name: 'generate_character_brief',
  description:
    'Create a character node in the active project using provided name and brief text.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      name: {
        type: Type.STRING,
        description: 'Character name to use for the generated node.',
      },
      brief: {
        type: Type.STRING,
        description: 'Character brief markdown content.',
      },
    },
  },
};

const GENERATE_CHARACTER_INSPIRATION_DECLARATION: FunctionDeclaration = {
  name: 'generate_character_inspiration',
  description:
    'Create a style/inspiration node for the active project based on provided style direction.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      styleName: {
        type: Type.STRING,
        description: 'Short style label for the inspiration node.',
      },
      description: {
        type: Type.STRING,
        description: 'Visual style description and direction.',
      },
    },
  },
};

const GENERATE_STORYBOARD_DECLARATION: FunctionDeclaration = {
  name: 'generate_storyboard',
  description:
    'Create a storyboard node for the active project with title and optional shot array.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      title: {
        type: Type.STRING,
        description: 'Storyboard title.',
      },
      shots: {
        type: Type.ARRAY,
        description:
          'Optional shot list to store in the storyboard node. Each item should be a JSON object.',
        items: {
          type: Type.OBJECT,
        },
      },
    },
  },
};

export function getGeminiToolDeclarations(hasActiveProject: boolean) {
  if (!hasActiveProject) {
    return [LIST_PROJECTS_DECLARATION];
  }

  return [
    LIST_PROJECTS_DECLARATION,
    IMPORT_STORY_MARKDOWN_DECLARATION,
    GENERATE_CHARACTER_BRIEF_DECLARATION,
    GENERATE_CHARACTER_INSPIRATION_DECLARATION,
    GENERATE_STORYBOARD_DECLARATION,
  ];
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
