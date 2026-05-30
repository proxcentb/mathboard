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

export type ImagePlacement = Omit<BoardImage, "src">;

export interface CanvasContent {
  id: string;
  title: string;
  strokes: Stroke[];
  images: BoardImage[];
}

export interface CanvasSnapshot extends CanvasContent {
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

export interface RemoteCursorPosition {
  socketId: string;
  canvasId: string;
  point: Point;
}

export interface RemoteCursorProfile extends ParticipantProfile {
  socketId: string;
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
      image: ImagePlacement;
    }
  | {
      type: "image:update";
      canvasId: string;
      image: ImagePlacement;
    }
  | {
      type: "image:delete";
      canvasId: string;
      imageId: string;
    }
  | {
      type: "canvas:clear";
      canvasId: string;
    }
  | {
      type: "canvas:create";
    }
  | {
      type: "canvas:move";
      canvasId: string;
      toIndex: number;
    }
  | {
      type: "canvas:delete";
      canvasId: string;
    }
  | {
      type: "history:undo";
      canvasId: string;
    }
  | {
      type: "history:redo";
      canvasId: string;
    };

export type BroadcastOperation = Extract<
  BoardOperation,
  { type: "stroke:add" | "image:add" | "image:update" | "image:delete" | "canvas:clear" }
>;

export interface OperationAppliedMessage {
  socketId: string;
  operation: BroadcastOperation;
  updatedAt: number;
}

export interface CanvasSnapshotMessage {
  updatedAt: number;
  canvas: CanvasContent & Partial<Pick<CanvasSnapshot, "canUndo" | "canRedo">>;
}

export interface HistoryStateMessage {
  canvasId: string;
  canUndo: boolean;
  canRedo: boolean;
}

export interface RoomRoleMessage {
  isAdmin: boolean;
}
