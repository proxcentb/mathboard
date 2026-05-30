import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { BoardService } from "./board.service";
import {
  BroadcastOperation,
  CanvasSnapshot,
  ClientBoardOperation,
  ClientOperationMessage,
  CursorLeaveMessage,
  CursorProfileUpdateMessage,
  CursorUpdateMessage,
  JoinRoomMessage,
  ImagePlacement,
  ParticipantProfile,
  ReplaceRoomMessage,
  StrokeEndMessage,
  StrokePreviewMessage
} from "./board.types";

const PARTICIPANT_PROFILES: Array<Omit<ParticipantProfile, "slot">> = [
  { name: "🦊", color: "#1d4ed8" },
  { name: "🐼", color: "#dc2626" },
  { name: "🐸", color: "#16a34a" },
  { name: "🐯", color: "#ea580c" },
  { name: "🐨", color: "#7c3aed" },
  { name: "🐰", color: "#db2777" },
  { name: "🐧", color: "#0891b2" },
  { name: "🐙", color: "#9333ea" },
  { name: "🦉", color: "#ca8a04" },
  { name: "🦁", color: "#be123c" },
  { name: "🐢", color: "#15803d" },
  { name: "🐳", color: "#0284c7" }
];

@WebSocketGateway({
  cors: {
    origin: true,
    credentials: true
  },
  maxHttpBufferSize: Number(process.env.SOCKET_MAX_HTTP_BUFFER_SIZE ?? 250 * 1024 * 1024)
})
export class BoardGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private readonly server!: Server;

  private readonly participants = new Map<string, Map<string, ParticipantProfile>>();
  private readonly socketRooms = new Map<string, Set<string>>();
  private readonly socketUserIds = new Map<string, string>();

  constructor(private readonly boardService: BoardService) {}

  handleConnection(client: Socket): void {
    client.emit("connection:ready", { socketId: client.id });
  }

  handleDisconnect(client: Socket): void {
    for (const roomId of this.socketRooms.get(client.id) ?? []) {
      client.broadcast.to(roomId).emit("cursor:leave", {
        socketId: client.id
      });
      client.broadcast.to(roomId).emit("cursor:profile:leave", {
        socketId: client.id
      });
      client.broadcast.to(roomId).emit("stroke:end", {
        socketId: client.id
      });
      this.participants.get(roomId)?.delete(client.id);
    }
    this.socketRooms.delete(client.id);
    this.socketUserIds.delete(client.id);
  }

  @SubscribeMessage("room:join")
  joinRoom(@ConnectedSocket() client: Socket, @MessageBody() payload: JoinRoomMessage): void {
    client.join(payload.roomId);
    this.trackRoom(client.id, payload.roomId);
    this.socketUserIds.set(client.id, payload.userId);
    const profile = this.assignProfile(payload.roomId, client.id);
    const snapshot = this.boardService.getOrCreateRoom(payload.roomId, payload.userId);
    client.emit("room:role", {
      isAdmin: this.boardService.claimRoomAdmin(payload.roomId, payload.userId)
    });
    client.emit("room:profile", profile);
    client.emit("room:snapshot", snapshot);

    for (const [socketId, participant] of this.participants.get(payload.roomId) ?? []) {
      if (socketId !== client.id) {
        client.emit("cursor:profile:update", { socketId, ...participant });
      }
    }
    client.broadcast.to(payload.roomId).emit("cursor:profile:update", {
      socketId: client.id,
      ...profile
    });
  }

  @SubscribeMessage("room:operation")
  applyOperation(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ClientOperationMessage
  ): void {
    const operation = payload.operation;
    const userId = this.socketUserIds.get(client.id) ?? client.id;
    const snapshot = this.boardService.applyClientOperation(payload.roomId, userId, operation);

    if (
      operation.type === "canvas:create" ||
      operation.type === "canvas:move" ||
      operation.type === "canvas:delete"
    ) {
      void this.emitRoomSnapshots(payload.roomId);
      return;
    }

    if (
      operation.type === "history:undo" ||
      operation.type === "history:redo"
    ) {
      const canvas = snapshot.canvases.find((item) => item.id === operation.canvasId);
      if (!canvas) {
        return;
      }

      void this.emitCanvasSnapshot(payload.roomId, userId, snapshot.updatedAt, canvas);
      return;
    }

    client.broadcast.to(payload.roomId).emit("room:operation:applied", {
      socketId: client.id,
      operation: this.toBroadcastOperation(operation),
      updatedAt: snapshot.updatedAt
    });
    const canvas = snapshot.canvases.find((item) => item.id === operation.canvasId);
    if (canvas) {
      void this.emitHistoryState(payload.roomId, userId, canvas);
    }
  }

  @SubscribeMessage("room:replace")
  replaceRoom(@MessageBody() payload: ReplaceRoomMessage): void {
    const snapshot = this.boardService.replaceRoom(payload.roomId, payload.snapshot);
    this.server.to(payload.roomId).emit("room:snapshot", snapshot);
  }

  @SubscribeMessage("cursor:update")
  updateCursor(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: CursorUpdateMessage
  ): void {
    client.broadcast.to(payload.roomId).emit("cursor:update", {
      socketId: client.id,
      canvasId: payload.canvasId,
      point: payload.point
    });
  }

  @SubscribeMessage("cursor:profile:update")
  updateCursorProfile(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: CursorProfileUpdateMessage
  ): void {
    const profile = this.assignProfile(payload.roomId, client.id);
    const nextProfile = {
      ...profile,
      name: payload.name,
      color: payload.color,
      avatar: payload.avatar
    };
    this.participants.get(payload.roomId)?.set(client.id, nextProfile);
    client.broadcast.to(payload.roomId).emit("cursor:profile:update", {
      socketId: client.id,
      ...nextProfile
    });
  }

  @SubscribeMessage("cursor:leave")
  leaveCursor(@ConnectedSocket() client: Socket, @MessageBody() payload: CursorLeaveMessage): void {
    client.broadcast.to(payload.roomId).emit("cursor:leave", {
      socketId: client.id
    });
  }

  @SubscribeMessage("stroke:preview")
  previewStroke(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: StrokePreviewMessage
  ): void {
    client.broadcast.to(payload.roomId).emit("stroke:preview", {
      socketId: client.id,
      canvasId: payload.canvasId,
      stroke: payload.stroke,
      isStart: payload.isStart
    });
  }

  @SubscribeMessage("stroke:end")
  endStroke(@ConnectedSocket() client: Socket, @MessageBody() payload: StrokeEndMessage): void {
    client.broadcast.to(payload.roomId).emit("stroke:end", {
      socketId: client.id,
      canvasId: payload.canvasId,
      strokeId: payload.strokeId
    });
  }

  private assignProfile(roomId: string, socketId: string): ParticipantProfile {
    let roomParticipants = this.participants.get(roomId);
    if (!roomParticipants) {
      roomParticipants = new Map();
      this.participants.set(roomId, roomParticipants);
    }

    const existing = roomParticipants.get(socketId);
    if (existing) {
      return existing;
    }

    const usedSlots = new Set(
      Array.from(roomParticipants.values()).map((participant) => participant.slot)
    );
    let slot = 0;
    while (usedSlots.has(slot)) {
      slot += 1;
    }

    const profile = PARTICIPANT_PROFILES[slot % PARTICIPANT_PROFILES.length];
    const participant = {
      slot,
      ...profile
    };
    roomParticipants.set(socketId, participant);

    return participant;
  }

  private trackRoom(socketId: string, roomId: string): void {
    const rooms = this.socketRooms.get(socketId) ?? new Set<string>();
    rooms.add(roomId);
    this.socketRooms.set(socketId, rooms);
  }

  private async emitRoomSnapshots(roomId: string): Promise<void> {
    const sockets = await this.server.in(roomId).fetchSockets();
    for (const socket of sockets) {
      socket.emit(
        "room:snapshot",
        this.boardService.getOrCreateRoom(roomId, this.socketUserIds.get(socket.id))
      );
    }
  }

  private toBroadcastOperation(operation: ClientBoardOperation): BroadcastOperation {
    if (operation.type === "stroke:add") {
      return operation;
    }

    if (operation.type === "canvas:clear") {
      return {
        type: operation.type,
        canvasId: operation.canvasId
      };
    }

    if (operation.type === "image:delete") {
      return {
        type: operation.type,
        canvasId: operation.canvasId,
        imageId: operation.imageId
      };
    }

    return {
      type: operation.type,
      canvasId: operation.canvasId,
      image: this.toImagePlacement(operation.image)
    };
  }

  private toImagePlacement(image: ImagePlacement): ImagePlacement {
    return {
      id: image.id,
      x: image.x,
      y: image.y,
      width: image.width,
      height: image.height
    };
  }

  private async emitCanvasSnapshot(
    roomId: string,
    userId: string,
    updatedAt: number,
    canvas: CanvasSnapshot
  ): Promise<void> {
    const sockets = await this.server.in(roomId).fetchSockets();
    for (const socket of sockets) {
      socket.emit("room:canvas:snapshot", {
        updatedAt,
        canvas:
          this.socketUserIds.get(socket.id) === userId
            ? canvas
            : {
                id: canvas.id,
                title: canvas.title,
                strokes: canvas.strokes,
                images: canvas.images
              }
      });
    }
  }

  private async emitHistoryState(
    roomId: string,
    userId: string,
    canvas: CanvasSnapshot
  ): Promise<void> {
    const sockets = await this.server.in(roomId).fetchSockets();
    for (const socket of sockets) {
      if (this.socketUserIds.get(socket.id) === userId) {
        socket.emit("room:history:state", {
          canvasId: canvas.id,
          canUndo: canvas.canUndo,
          canRedo: canvas.canRedo
        });
      }
    }
  }
}
