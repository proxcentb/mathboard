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
      type: "canvas:clear";
      canvasId: string;
      before: {
        strokes: Stroke[];
        images: BoardImage[];
      };
    };

export type ClientOperation =
  | BoardOperation
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

export interface ClientOperationMessage {
  roomId: string;
  operation: ClientOperation;
}

export interface JoinRoomMessage {
  roomId: string;
}

export interface ParticipantProfile {
  slot: number;
  name: string;
  color: string;
}

export interface CursorUpdateMessage {
  roomId: string;
  canvasId: string;
  name: string;
  point: Point;
}

export interface CursorLeaveMessage {
  roomId: string;
}

export interface StrokePreviewMessage {
  roomId: string;
  canvasId: string;
  stroke: Stroke;
}

export interface StrokeEndMessage {
  roomId: string;
  canvasId: string;
  strokeId: string;
}
