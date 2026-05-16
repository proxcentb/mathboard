import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  BoardImage,
  BoardOperation,
  CanvasSnapshot,
  ClientOperation,
  ImportedRoomSnapshot,
  RoomSnapshot,
  Stroke
} from "./board.types";

interface CanvasState {
  id: string;
  title: string;
  strokes: Stroke[];
  images: BoardImage[];
  history: BoardOperation[];
  future: BoardOperation[];
}

interface RoomState {
  id: string;
  canvases: CanvasState[];
  updatedAt: number;
}

interface StoredImage {
  contentType: string;
  data: Buffer;
}

@Injectable()
export class BoardService {
  private readonly rooms = new Map<string, RoomState>();
  private readonly images = new Map<string, StoredImage>();

  createRoom(): RoomSnapshot {
    const id = this.createReadableId();
    const room: RoomState = {
      id,
      canvases: [this.createCanvas(1)],
      updatedAt: Date.now()
    };

    this.rooms.set(id, room);
    return this.toSnapshot(room);
  }

  getOrCreateRoom(id: string): RoomSnapshot {
    const existing = this.rooms.get(id);
    if (existing) {
      return this.toSnapshot(existing);
    }

    const room: RoomState = {
      id,
      canvases: [this.createCanvas(1)],
      updatedAt: Date.now()
    };

    this.rooms.set(id, room);
    return this.toSnapshot(room);
  }

  replaceRoom(roomId: string, snapshot: ImportedRoomSnapshot): RoomSnapshot {
    if (snapshot.canvases.length === 0) {
      throw new BadRequestException("Imported room must contain at least one canvas");
    }

    const room: RoomState = {
      id: roomId,
      updatedAt: Date.now(),
      canvases: snapshot.canvases.map((canvas, index): CanvasState => ({
        id: canvas.id || randomUUID(),
        title: canvas.title || `Холст ${index + 1}`,
        strokes: canvas.strokes,
        images: canvas.images,
        history: [],
        future: []
      }))
    };

    this.rooms.set(roomId, room);
    return this.toSnapshot(room);
  }

  storeImage(dataUrl: string): { id: string } {
    const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
    if (!match) {
      throw new BadRequestException("Expected a base64 data URL");
    }

    const [, contentType, base64] = match;
    if (!contentType.startsWith("image/")) {
      throw new BadRequestException("Only images can be uploaded");
    }

    const id = randomUUID();
    this.images.set(id, {
      contentType,
      data: Buffer.from(base64, "base64")
    });

    return { id };
  }

  getImage(id: string): StoredImage {
    const image = this.images.get(id);
    if (!image) {
      throw new NotFoundException(`Image ${id} does not exist`);
    }

    return image;
  }

  applyClientOperation(roomId: string, operation: ClientOperation): RoomSnapshot {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new NotFoundException(`Room ${roomId} does not exist`);
    }

    if (operation.type === "canvas:create") {
      room.canvases.push(this.createCanvas(room.canvases.length + 1));
      return this.touch(room);
    }

    const canvas = room.canvases.find((item) => item.id === operation.canvasId);
    if (!canvas) {
      throw new NotFoundException(`Canvas ${operation.canvasId} does not exist`);
    }

    if (operation.type === "history:undo") {
      const last = canvas.history.pop();
      if (last) {
        this.revert(canvas, last);
        canvas.future.push(last);
      }

      return this.touch(room);
    }

    if (operation.type === "history:redo") {
      const next = canvas.future.pop();
      if (next) {
        this.apply(canvas, next);
        canvas.history.push(next);
      }

      return this.touch(room);
    }

    this.apply(canvas, operation);
    canvas.history.push(operation);
    canvas.future = [];

    return this.touch(room);
  }

  private apply(canvas: CanvasState, operation: BoardOperation): void {
    if (operation.type === "stroke:add") {
      canvas.strokes.push(operation.stroke);
      return;
    }

    if (operation.type === "image:add") {
      canvas.images.push(operation.image);
      return;
    }

    if (operation.type === "image:delete") {
      canvas.images = canvas.images.filter((image) => image.id !== operation.image.id);
      return;
    }

    if (operation.type === "canvas:clear") {
      canvas.strokes = [];
      canvas.images = [];
      return;
    }

    canvas.images = canvas.images.map((image) =>
      image.id === operation.after.id ? operation.after : image
    );
  }

  private revert(canvas: CanvasState, operation: BoardOperation): void {
    if (operation.type === "stroke:add") {
      canvas.strokes = canvas.strokes.filter((stroke) => stroke.id !== operation.stroke.id);
      return;
    }

    if (operation.type === "image:add") {
      canvas.images = canvas.images.filter((image) => image.id !== operation.image.id);
      return;
    }

    if (operation.type === "image:delete") {
      canvas.images.push(operation.image);
      return;
    }

    if (operation.type === "canvas:clear") {
      canvas.strokes = operation.before.strokes;
      canvas.images = operation.before.images;
      return;
    }

    canvas.images = canvas.images.map((image) =>
      image.id === operation.before.id ? operation.before : image
    );
  }

  private touch(room: RoomState): RoomSnapshot {
    room.updatedAt = Date.now();
    return this.toSnapshot(room);
  }

  private toSnapshot(room: RoomState): RoomSnapshot {
    return {
      id: room.id,
      updatedAt: room.updatedAt,
      canvases: room.canvases.map((canvas): CanvasSnapshot => ({
        id: canvas.id,
        title: canvas.title,
        strokes: canvas.strokes,
        images: canvas.images,
        canUndo: canvas.history.length > 0,
        canRedo: canvas.future.length > 0
      }))
    };
  }

  private createCanvas(index: number): CanvasState {
    return {
      id: randomUUID(),
      title: `Холст ${index}`,
      strokes: [],
      images: [],
      history: [],
      future: []
    };
  }

  private createReadableId(): string {
    return randomUUID().replace(/-/g, "").slice(0, 12);
  }
}
