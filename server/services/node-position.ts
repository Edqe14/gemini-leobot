import { prisma } from '../lib/db';

export type CanvasPosition = {
  x: number;
  y: number;
};

type CharacterProfileWithDesignPosition = {
  characterDesignNodePosition?: {
    x?: unknown;
    y?: unknown;
  };
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

function parseCharacterDesignPosition(
  profileJson: string | null | undefined,
): CanvasPosition | null {
  if (!profileJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      profileJson,
    ) as CharacterProfileWithDesignPosition;
    const position = parsed?.characterDesignNodePosition;
    if (
      !position ||
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y)
    ) {
      return null;
    }

    return {
      x: Number(position.x),
      y: Number(position.y),
    };
  } catch {
    return null;
  }
}

function toDefaultCharacterDesignPosition(
  characterPosition: CanvasPosition,
): CanvasPosition {
  return {
    x: characterPosition.x + 760,
    y: characterPosition.y,
  };
}

function appendOccupiedFootprint(
  occupied: Set<string>,
  position: CanvasPosition,
  input?: { colSpan?: number; rowSpan?: number },
) {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    return;
  }

  const { col, row } = toGridCell(position);
  const colSpan = Math.max(1, Math.floor(input?.colSpan ?? 1));
  const rowSpan = Math.max(1, Math.floor(input?.rowSpan ?? 1));

  for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
    for (let colOffset = 0; colOffset < colSpan; colOffset += 1) {
      occupied.add(cellKey(col + colOffset, row + rowOffset));
    }
  }
}

function canPlaceFootprint(input: {
  occupied: Set<string>;
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
}) {
  for (let rowOffset = 0; rowOffset < input.rowSpan; rowOffset += 1) {
    for (let colOffset = 0; colOffset < input.colSpan; colOffset += 1) {
      if (
        input.occupied.has(
          cellKey(input.col + colOffset, input.row + rowOffset),
        )
      ) {
        return false;
      }
    }
  }

  return true;
}

function reserveFootprint(input: {
  occupied: Set<string>;
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
}) {
  for (let rowOffset = 0; rowOffset < input.rowSpan; rowOffset += 1) {
    for (let colOffset = 0; colOffset < input.colSpan; colOffset += 1) {
      input.occupied.add(cellKey(input.col + colOffset, input.row + rowOffset));
    }
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
          profileJson: true,
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

export async function allocateCharacterBriefPositions(
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
          profileJson: true,
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
    appendOccupiedFootprint(
      occupied,
      {
        x: project.story.positionX ?? 80,
        y: project.story.positionY ?? 120,
      },
      {
        // Story nodes are wide/tall; reserve extra cells to avoid overlap.
        colSpan: 3,
        rowSpan: 3,
      },
    );
  }

  for (const [index, node] of (project?.characterNodes ?? []).entries()) {
    const characterPosition = {
      x: node.positionX ?? 640,
      y: node.positionY ?? 120 + index * 440,
    };
    const designPosition =
      parseCharacterDesignPosition(node.profileJson) ??
      toDefaultCharacterDesignPosition(characterPosition);

    appendOccupiedFootprint(occupied, characterPosition, {
      colSpan: 2,
      rowSpan: 2,
    });

    appendOccupiedFootprint(occupied, designPosition, {
      colSpan: 2,
      rowSpan: 2,
    });
  }

  for (const [index, node] of (project?.styleNodes ?? []).entries()) {
    appendOccupiedFootprint(
      occupied,
      {
        x: node.positionX ?? 980,
        y: node.positionY ?? 120 + index * 190,
      },
      {
        colSpan: 2,
        rowSpan: 2,
      },
    );
  }

  for (const [index, node] of (project?.storyboardNodes ?? []).entries()) {
    appendOccupiedFootprint(
      occupied,
      {
        x: node.positionX ?? 1320,
        y: node.positionY ?? 120 + index * 190,
      },
      {
        colSpan: 2,
        rowSpan: 2,
      },
    );
  }

  const allocated: CanvasPosition[] = [];

  for (let row = 0; row < GRID_MAX_ROWS; row += 1) {
    for (let col = 2; col < GRID_MAX_COLUMNS - 1; col += 1) {
      const characterPosition = toCanvasPosition(col, row);
      const associatedDesignPosition =
        toDefaultCharacterDesignPosition(characterPosition);
      const designCell = toGridCell(associatedDesignPosition);

      if (
        !canPlaceFootprint({
          occupied,
          col,
          row,
          colSpan: 2,
          rowSpan: 2,
        })
      ) {
        continue;
      }

      if (
        !canPlaceFootprint({
          occupied,
          col: designCell.col,
          row: designCell.row,
          colSpan: 2,
          rowSpan: 2,
        })
      ) {
        continue;
      }

      reserveFootprint({
        occupied,
        col,
        row,
        colSpan: 2,
        rowSpan: 2,
      });

      reserveFootprint({
        occupied,
        col: designCell.col,
        row: designCell.row,
        colSpan: 2,
        rowSpan: 2,
      });

      allocated.push(characterPosition);

      if (allocated.length === count) {
        return allocated;
      }
    }
  }

  const fallback = await allocateNodePositions(
    projectId,
    count - allocated.length,
  );
  return [...allocated, ...fallback].slice(0, count);
}
