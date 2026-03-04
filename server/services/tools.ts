import { prisma } from '../lib/db'

type ToolContext = {
  userId: string
  projectId?: string
  args: Record<string, unknown>
}

export async function importStoryMarkdownTool(context: ToolContext) {
  return {
    ok: true,
    message: 'Use /api/projects/:id/story/import to import markdown from Google Docs.',
    received: context.args,
  }
}

export async function generateCharacterBriefTool(context: ToolContext) {
  if (!context.projectId) {
    throw new Error('projectId is required for character brief generation')
  }

  const name = String(context.args.name ?? 'New Character')
  const brief = String(context.args.brief ?? 'Character brief generated from story context.')

  const node = await prisma.characterNode.create({
    data: {
      projectId: context.projectId,
      name,
      briefMarkdown: brief,
      inspirationUrls: [],
    },
  })

  return { ok: true, node }
}

export async function generateCharacterInspirationTool(context: ToolContext) {
  if (!context.projectId) {
    throw new Error('projectId is required for inspiration generation')
  }

  const styleNode = await prisma.styleNode.create({
    data: {
      projectId: context.projectId,
      name: String(context.args.styleName ?? 'Default Style'),
      description: String(context.args.description ?? 'Generated style reference from story and character brief.'),
    },
  })

  return { ok: true, styleNode }
}

export async function generateStoryboardTool(context: ToolContext) {
  if (!context.projectId) {
    throw new Error('projectId is required for storyboard generation')
  }

  const storyboard = await prisma.storyboardNode.create({
    data: {
      projectId: context.projectId,
      title: String(context.args.title ?? 'Storyboard Draft'),
      shotsJson: JSON.stringify(context.args.shots ?? []),
    },
  })

  return { ok: true, storyboard }
}
