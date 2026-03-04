import { prisma } from '../lib/db';

export async function listProjectsForUser(userId: string) {
  return prisma.project.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    include: {
      story: true,
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
      story: true,
      characterNodes: true,
      styleNodes: true,
      storyboardNodes: true,
    },
  });
}
