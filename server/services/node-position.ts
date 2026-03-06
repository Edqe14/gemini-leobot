import { prisma } from '../lib/db';

export type CanvasPosition = {
  x: number;
  y: number;
};

const GRID_START_X = 80;
const GRID_START_Y = 120;
const GRID_STEP_X = 360;
const GRID_STEP_Y = 220;
const GRID_MAX_COLUMNS = 8;
const GRID_MAX_ROWS = 200;

function cellKey(col: number, row: number) {
  return `${col}:${row}`;
}

function toGridCell(position: CanvasPosition) {
  const col = Math.max(
    0,
    Math.round((position.x - GRID_START_X) / GRID_STEP_X),
  );
  const row = Math.max(
    0,
    Math.round((position.y - GRID_START_Y) / GRID_STEP_Y),
  );

  return { col, row };
}

function toCanvasPosition(col: number, row: number): CanvasPosition {
  return {
    x: GRID_START_X + col * GRID_STEP_X,
    y: GRID_START_Y + row * GRID_STEP_Y,
  };
}

function appendOccupiedCells(
  occupied: Set<string>,
  positions: CanvasPosition[],
) {
  for (const position of positions) {
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
      continue;
    }

    const cell = toGridCell(position);
    occupied.add(cellKey(cell.col, cell.row));
  }
}

export async function allocateNodePositions(
  projectId: string,
  count: number,
): Promise<CanvasPosition[]> {
  if (!count || count <= 0) {
    return [];
  }

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
        select: {
          positionX: true,
          positionY: true,
        },
      },
      styleNodes: {
        select: {
          positionX: true,
          positionY: true,
        },
      },
      storyboardNodes: {
        select: {
          positionX: true,
          positionY: true,
        },
      },
    },
  });

  const occupied = new Set<string>();

  if (project?.story) {
    appendOccupiedCells(occupied, [
      {
        x: project.story.positionX ?? 80,
        y: project.story.positionY ?? 120,
      },
    ]);
  }

  appendOccupiedCells(
    occupied,
    (project?.characterNodes ?? []).map((node, index) => ({
      x: node.positionX ?? 640,
      y: node.positionY ?? 120 + index * 440,
    })),
  );

  appendOccupiedCells(
    occupied,
    (project?.styleNodes ?? []).map((node, index) => ({
      x: node.positionX ?? 980,
      y: node.positionY ?? 120 + index * 190,
    })),
  );

  appendOccupiedCells(
    occupied,
    (project?.storyboardNodes ?? []).map((node, index) => ({
      x: node.positionX ?? 1320,
      y: node.positionY ?? 120 + index * 190,
    })),
  );

  const allocated: CanvasPosition[] = [];

  for (let row = 0; row < GRID_MAX_ROWS; row += 1) {
    for (let col = 0; col < GRID_MAX_COLUMNS; col += 1) {
      const key = cellKey(col, row);
      if (occupied.has(key)) {
        continue;
      }

      occupied.add(key);
      allocated.push(toCanvasPosition(col, row));

      if (allocated.length === count) {
        return allocated;
      }
    }
  }

  // Fallback for unexpectedly dense canvases.
  while (allocated.length < count) {
    const row = GRID_MAX_ROWS + allocated.length;
    allocated.push(toCanvasPosition(0, row));
  }

  return allocated;
}
