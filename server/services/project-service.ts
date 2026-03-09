import { prisma } from '../lib/db';

const storyInclude = {
  include: {
    revisions: {
      orderBy: {
        acceptedAt: 'desc' as const,
      },
      take: 12,
    },
  },
};

export async function listProjectsForUser(userId: string) {
  return prisma.project.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    include: {
      story: storyInclude,
      characterNodes: true,
      styleNodes: true,
      storyboardNodes: true,
    },
  });
}

export async function createProjectForUser(userId: string, name: string) {
  return prisma.project.create({
    data: {
      userId,
      name,
    },
  });
}

export async function getProjectForUser(userId: string, projectId: string) {
  return prisma.project.findFirst({
    where: {
      id: projectId,
      userId,
    },
    include: {
      story: storyInclude,
      characterNodes: true,
      styleNodes: true,
      storyboardNodes: true,
    },
  });
}
