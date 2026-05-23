export type DrawingTool = "pen" | "eraser";

export interface Point {
  x: number;
  y: number;
}

export interface Stroke {
  id: string;
  tool: DrawingTool;
  color: string;
  size: number;
  points: Point[];
}

export interface BoardImage {
  id: string;
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasSnapshot {
  id: string;
  title: string;
  strokes: Stroke[];
  images: BoardImage[];
  canUndo: boolean;
  canRedo: boolean;
}

export interface RoomSnapshot {
  id: string;
  canvases: CanvasSnapshot[];
  updatedAt: number;
}

export interface AdminRoomSummary {
  id: string;
  updatedAt: number;
  canvasCount: number;
  strokeCount: number;
  imageCount: number;
  operationCount: number;
}

export interface AdminSummary {
  generatedAt: number;
  rooms: AdminRoomSummary[];
  totals: {
    rooms: number;
    canvases: number;
    strokes: number;
    images: number;
    storedImageBytes: number;
  };
  process: {
    pid: number;
    uptimeSeconds: number;
    memory: {
      rss: number;
      heapTotal: number;
      heapUsed: number;
      external: number;
      arrayBuffers: number;
    };
    cpu: {
      userSeconds: number;
      systemSeconds: number;
      percent: number | null;
    };
  };
}

export interface ImportedCanvasSnapshot {
  id: string;
  title: string;
  strokes: Stroke[];
  images: BoardImage[];
}

export interface ImportedRoomSnapshot {
  canvases: ImportedCanvasSnapshot[];
}

export interface MathboardExportFile {
  app: "mathboard";
  version: 1;
  exportedAt: string;
  room: ImportedRoomSnapshot;
}

export interface RemoteCursor {
  socketId: string;
  canvasId: string;
  name: string;
  color?: string;
  avatar?: ParticipantAvatar;
  point: Point;
}

export type RemoteCursorEvent =
  | {
      type: "update";
      cursor: RemoteCursor;
    }
  | {
      type: "leave";
      socketId: string;
    };

export interface RemoteCursorStore {
  getSnapshot: () => RemoteCursor[];
  subscribe: (listener: (event: RemoteCursorEvent) => void) => () => void;
}

export interface RemoteStroke {
  socketId: string;
  canvasId: string;
  stroke: Stroke;
  isStart: boolean;
}

export interface ParticipantProfile {
  slot: number;
  name: string;
  color: string;
  avatar?: ParticipantAvatar;
}

export type ParticipantAvatar =
  | {
      type: "emoji";
      value: string;
    }
  | {
      type: "image";
      name: string;
      src?: string;
      alt?: string;
    };

export type BoardOperation =
  | {
      type: "stroke:add";
      canvasId: string;
      stroke: Stroke;
    }
  | {
      type: "image:add";
      canvasId: string;
      image: BoardImage;
    }
  | {
      type: "image:update";
      canvasId: string;
      before: BoardImage;
      after: BoardImage;
    }
  | {
      type: "image:delete";
      canvasId: string;
      image: BoardImage;
    }
  | {
      type: "canvas:clear";
      canvasId: string;
      before: {
        strokes: Stroke[];
        images: BoardImage[];
      };
    }
  | {
      type: "canvas:create";
    }
  | {
      type: "history:undo";
      canvasId: string;
    }
  | {
      type: "history:redo";
      canvasId: string;
    };

export type BroadcastOperation =
  | Extract<
      BoardOperation,
      { type: "stroke:add" | "image:add" | "image:update" | "image:delete" }
    >
  | {
      type: "canvas:clear";
      canvasId: string;
    };

export interface OperationAppliedMessage {
  socketId: string;
  operation: BroadcastOperation;
  updatedAt: number;
  canvas: {
    id: string;
    canUndo: boolean;
    canRedo: boolean;
  };
}
