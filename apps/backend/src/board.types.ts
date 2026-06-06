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
    memory: NodeJS.MemoryUsage;
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
    };

export type ClientBoardOperation =
  | Extract<BoardOperation, { type: "stroke:add" }>
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
    };

export type ClientOperation =
  | ClientBoardOperation
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

export type BroadcastOperation =
  ClientBoardOperation;

export interface ClientOperationMessage {
  roomId: string;
  operation: ClientOperation;
}

export interface ReplaceRoomMessage {
  roomId: string;
  snapshot: ImportedRoomSnapshot;
}

export interface OperationAppliedMessage {
  socketId: string;
  operation: BroadcastOperation;
  updatedAt: number;
}

export interface CanvasSnapshotMessage {
  updatedAt: number;
  canvas: CanvasContent | CanvasSnapshot;
}

export interface JoinRoomMessage {
  roomId: string;
  userId: string;
}

export interface RoomRoleMessage {
  isAdmin: boolean;
}

export interface ParticipantProfile {
  slot: number;
  name: string;
  color: string;
  avatarId: string;
}

export interface CursorUpdateMessage {
  roomId: string;
  canvasId: string;
  point: Point;
}

export interface CursorProfileUpdateMessage {
  roomId: string;
  name: string;
  color: string;
  avatarId: string;
}

export interface CursorLeaveMessage {
  roomId: string;
}

export interface StrokePreviewMessage {
  roomId: string;
  canvasId: string;
  stroke: Stroke;
  isStart: boolean;
}

export interface StrokeEndMessage {
  roomId: string;
  canvasId: string;
  strokeId: string;
}
