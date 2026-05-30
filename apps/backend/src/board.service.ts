import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  BoardImage,
  BoardOperation,
  AdminRoomSummary,
  CanvasSnapshot,
  ClientBoardOperation,
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
  histories: Map<string, UserHistoryState>;
}

interface UserHistoryState {
  history: BoardOperation[];
  future: BoardOperation[];
}

interface RoomState {
  id: string;
  canvases: CanvasState[];
  updatedAt: number;
  adminUserId?: string;
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

  getOrCreateRoom(id: string, userId?: string): RoomSnapshot {
    const existing = this.rooms.get(id);
    if (existing) {
      return this.toSnapshot(existing, userId);
    }

    const room: RoomState = {
      id,
      canvases: [this.createCanvas(1)],
      updatedAt: Date.now()
    };

    this.rooms.set(id, room);
    return this.toSnapshot(room);
  }

  claimRoomAdmin(roomId: string, userId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new NotFoundException(`Room ${roomId} does not exist`);
    }

    room.adminUserId ??= userId;
    return room.adminUserId === userId;
  }

  listRooms(): AdminRoomSummary[] {
    return Array.from(this.rooms.values())
      .map((room) => {
        const strokeCount = room.canvases.reduce(
          (sum, canvas) => sum + canvas.strokes.length,
          0
        );
        const imageCount = room.canvases.reduce(
          (sum, canvas) => sum + canvas.images.length,
          0
        );
        const operationCount = room.canvases.reduce(
          (sum, canvas) =>
            sum +
            Array.from(canvas.histories.values()).reduce(
              (canvasSum, state) => canvasSum + state.history.length + state.future.length,
              0
            ),
          0
        );

        return {
          id: room.id,
          updatedAt: room.updatedAt,
          canvasCount: room.canvases.length,
          strokeCount,
          imageCount,
          operationCount
        };
      })
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  getStoredImageBytes(): number {
    let bytes = 0;
    for (const image of this.images.values()) {
      bytes += image.data.byteLength;
    }
    return bytes;
  }

  deleteRoom(id: string): boolean {
    const room = this.rooms.get(id);
    if (!room || !this.rooms.delete(id)) {
      return false;
    }

    const deletedImageIds = this.imageIdsForRoom(room);
    const remainingImageIds = new Set<string>();
    for (const remainingRoom of this.rooms.values()) {
      for (const imageId of this.imageIdsForRoom(remainingRoom)) {
        remainingImageIds.add(imageId);
      }
    }

    for (const imageId of deletedImageIds) {
      if (!remainingImageIds.has(imageId)) {
        this.images.delete(imageId);
      }
    }

    return true;
  }

  replaceRoom(roomId: string, snapshot: ImportedRoomSnapshot): RoomSnapshot {
    if (snapshot.canvases.length === 0) {
      throw new BadRequestException("Imported room must contain at least one canvas");
    }

    const room: RoomState = {
      id: roomId,
      updatedAt: Date.now(),
      adminUserId: this.rooms.get(roomId)?.adminUserId,
      canvases: snapshot.canvases.map((canvas, index): CanvasState => ({
        id: canvas.id || randomUUID(),
        title: canvas.title || `Холст ${index + 1}`,
        strokes: canvas.strokes,
        images: canvas.images,
        histories: new Map()
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

  applyClientOperation(
    roomId: string,
    userId: string,
    operation: ClientOperation
  ): RoomSnapshot {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new NotFoundException(`Room ${roomId} does not exist`);
    }

    if (operation.type === "canvas:create") {
      room.canvases.push(this.createCanvas(room.canvases.length + 1));
      return this.touch(room, userId);
    }

    if (operation.type === "canvas:move") {
      this.assertRoomAdmin(room, userId);
      const fromIndex = room.canvases.findIndex((canvas) => canvas.id === operation.canvasId);
      if (fromIndex === -1) {
        throw new NotFoundException(`Canvas ${operation.canvasId} does not exist`);
      }
      if (operation.toIndex < 0 || operation.toIndex >= room.canvases.length) {
        throw new BadRequestException(`Canvas index ${operation.toIndex} is out of bounds`);
      }
      if (fromIndex === operation.toIndex) {
        return this.toSnapshot(room, userId);
      }

      const [canvas] = room.canvases.splice(fromIndex, 1);
      room.canvases.splice(operation.toIndex, 0, canvas);
      return this.touch(room, userId);
    }

    if (operation.type === "canvas:delete") {
      this.assertRoomAdmin(room, userId);
      if (room.canvases.length === 1) {
        throw new BadRequestException("Cannot delete the only canvas");
      }

      const canvasIndex = room.canvases.findIndex((canvas) => canvas.id === operation.canvasId);
      if (canvasIndex === -1) {
        throw new NotFoundException(`Canvas ${operation.canvasId} does not exist`);
      }

      const deletedImageIds = this.imageIdsForCanvas(room.canvases[canvasIndex]);
      room.canvases.splice(canvasIndex, 1);
      this.deleteUnusedImages(deletedImageIds);
      return this.touch(room, userId);
    }

    const canvas = room.canvases.find((item) => item.id === operation.canvasId);
    if (!canvas) {
      throw new NotFoundException(`Canvas ${operation.canvasId} does not exist`);
    }

    if (operation.type === "history:undo") {
      const state = this.historyFor(canvas, userId);
      const last = state.history.pop();
      if (last) {
        this.revert(canvas, last);
        state.future.push(last);
      }

      return this.touch(room, userId);
    }

    if (operation.type === "history:redo") {
      const state = this.historyFor(canvas, userId);
      const next = state.future.pop();
      if (next) {
        this.apply(canvas, next);
        state.history.push(next);
      }

      return this.touch(room, userId);
    }

    const normalizedOperation = this.normalizeOperation(canvas, operation);
    this.apply(canvas, normalizedOperation);
    const state = this.historyFor(canvas, userId);
    state.history.push(normalizedOperation);
    state.future = [];

    return this.touch(room, userId);
  }

  private normalizeOperation(
    canvas: CanvasState,
    operation: ClientBoardOperation
  ): BoardOperation {
    if (operation.type === "stroke:add") {
      return operation;
    }

    if (operation.type === "image:add") {
      if (!this.images.has(operation.image.id)) {
        throw new NotFoundException(`Image ${operation.image.id} does not exist`);
      }

      return {
        ...operation,
        image: {
          ...operation.image,
          src: this.imageSrc(operation.image.id)
        }
      };
    }

    if (operation.type === "canvas:clear") {
      return {
        ...operation,
        before: {
          strokes: canvas.strokes,
          images: canvas.images
        }
      };
    }

    const existing = canvas.images.find((image) =>
      image.id === (operation.type === "image:update" ? operation.image.id : operation.imageId)
    );
    if (!existing) {
      throw new NotFoundException("Canvas image does not exist");
    }

    if (operation.type === "image:delete") {
      return {
        type: operation.type,
        canvasId: operation.canvasId,
        image: existing
      };
    }

    return {
      type: operation.type,
      canvasId: operation.canvasId,
      before: existing,
      after: {
        ...existing,
        ...operation.image
      }
    };
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

  private touch(room: RoomState, userId?: string): RoomSnapshot {
    room.updatedAt = Date.now();
    return this.toSnapshot(room, userId);
  }

  private toSnapshot(room: RoomState, userId?: string): RoomSnapshot {
    return {
      id: room.id,
      updatedAt: room.updatedAt,
      canvases: room.canvases.map((canvas): CanvasSnapshot => {
        const state = userId ? canvas.histories.get(userId) : undefined;
        return {
          id: canvas.id,
          title: canvas.title,
          strokes: canvas.strokes,
          images: canvas.images,
          canUndo: (state?.history.length ?? 0) > 0,
          canRedo: (state?.future.length ?? 0) > 0
        };
      })
    };
  }

  private createCanvas(index: number): CanvasState {
    return {
      id: randomUUID(),
      title: `Холст ${index}`,
      strokes: [],
      images: [],
      histories: new Map()
    };
  }

  private historyFor(canvas: CanvasState, userId: string): UserHistoryState {
    const existing = canvas.histories.get(userId);
    if (existing) {
      return existing;
    }

    const state = {
      history: [],
      future: []
    };
    canvas.histories.set(userId, state);
    return state;
  }

  private assertRoomAdmin(room: RoomState, userId: string): void {
    if (room.adminUserId !== userId) {
      throw new ForbiddenException("Only the room admin can manage canvases");
    }
  }

  private createReadableId(): string {
    return randomUUID().replace(/-/g, "").slice(0, 12);
  }

  private imageIdsForRoom(room: RoomState): Set<string> {
    const ids = new Set<string>();
    for (const canvas of room.canvases) {
      for (const imageId of this.imageIdsForCanvas(canvas)) {
        ids.add(imageId);
      }
    }
    return ids;
  }

  private imageIdsForCanvas(canvas: CanvasState): Set<string> {
    const ids = new Set<string>();
    for (const image of canvas.images) {
      const imageId = this.storedImageIdFromSrc(image.src);
      if (imageId) {
        ids.add(imageId);
      }
    }

    for (const state of canvas.histories.values()) {
      for (const operation of [...state.history, ...state.future]) {
        for (const image of this.imagesForOperation(operation)) {
          const imageId = this.storedImageIdFromSrc(image.src);
          if (imageId) {
            ids.add(imageId);
          }
        }
      }
    }
    return ids;
  }

  private deleteUnusedImages(imageIds: Set<string>): void {
    const remainingImageIds = new Set<string>();
    for (const room of this.rooms.values()) {
      for (const imageId of this.imageIdsForRoom(room)) {
        remainingImageIds.add(imageId);
      }
    }

    for (const imageId of imageIds) {
      if (!remainingImageIds.has(imageId)) {
        this.images.delete(imageId);
      }
    }
  }

  private imagesForOperation(operation: BoardOperation): BoardImage[] {
    if (operation.type === "stroke:add") {
      return [];
    }

    if (operation.type === "image:update") {
      return [operation.before, operation.after];
    }

    if (operation.type === "canvas:clear") {
      return operation.before.images;
    }

    return [operation.image];
  }

  private imageSrc(id: string): string {
    return `/api/images/${encodeURIComponent(id)}`;
  }

  private storedImageIdFromSrc(src: string): string | null {
    const match = src.match(/\/images\/([^/?#]+)/);
    return match?.[1] ?? null;
  }
}
