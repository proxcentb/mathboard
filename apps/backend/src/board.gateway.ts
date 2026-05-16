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
  ClientOperationMessage,
  CursorLeaveMessage,
  CursorUpdateMessage,
  JoinRoomMessage,
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
  }
})
export class BoardGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private readonly server!: Server;

  private readonly participants = new Map<string, Map<string, ParticipantProfile>>();
  private readonly socketRooms = new Map<string, Set<string>>();

  constructor(private readonly boardService: BoardService) {}

  handleConnection(client: Socket): void {
    client.emit("connection:ready", { socketId: client.id });
  }

  handleDisconnect(client: Socket): void {
    for (const roomId of this.socketRooms.get(client.id) ?? []) {
      client.broadcast.to(roomId).emit("cursor:leave", {
        socketId: client.id
      });
      client.broadcast.to(roomId).emit("stroke:end", {
        socketId: client.id
      });
      this.participants.get(roomId)?.delete(client.id);
    }
    this.socketRooms.delete(client.id);
  }

  @SubscribeMessage("room:join")
  joinRoom(@ConnectedSocket() client: Socket, @MessageBody() payload: JoinRoomMessage): void {
    client.join(payload.roomId);
    this.trackRoom(client.id, payload.roomId);
    client.emit("room:profile", this.assignProfile(payload.roomId, client.id));
    client.emit("room:snapshot", this.boardService.getOrCreateRoom(payload.roomId));
  }

  @SubscribeMessage("room:operation")
  applyOperation(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ClientOperationMessage
  ): void {
    const operation = payload.operation;
    const snapshot = this.boardService.applyClientOperation(payload.roomId, operation);

    if (operation.type === "canvas:create") {
      this.server.to(payload.roomId).emit("room:snapshot", snapshot);
      return;
    }

    if (
      operation.type === "history:undo" ||
      operation.type === "history:redo"
    ) {
      this.server.to(payload.roomId).emit("room:snapshot", snapshot);
      return;
    }

    const canvas = snapshot.canvases.find((item) => item.id === operation.canvasId);
    if (!canvas) {
      return;
    }

    client.broadcast.to(payload.roomId).emit("room:operation:applied", {
      socketId: client.id,
      operation: this.toBroadcastOperation(operation),
      updatedAt: snapshot.updatedAt,
      canvas: {
        id: canvas.id,
        canUndo: canvas.canUndo,
        canRedo: canvas.canRedo
      }
    });
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
      name: payload.name,
      point: payload.point
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

  private toBroadcastOperation(operation: BroadcastOperation): BroadcastOperation {
    if (operation.type !== "canvas:clear") {
      return operation;
    }

    return {
      type: "canvas:clear",
      canvasId: operation.canvasId
    };
  }
}
