import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { availableParallelism } from "node:os";
import { BoardService } from "./board.service";
import {
  AdminSummary,
  ImportedRoomSnapshot,
  RoomSnapshot,
} from "./board.types";

interface HttpResponse {
  setHeader(name: string, value: string): void;
  send(body: Buffer): void;
}

@Controller()
export class AppController {
  private lastCpuSample: {
    at: bigint;
    usage: NodeJS.CpuUsage;
  } | null = null;

  constructor(private readonly boardService: BoardService) {}

  @Post("rooms")
  createRoom(): RoomSnapshot {
    return this.boardService.createRoom();
  }

  @Post("rooms/:id")
  openRoom(@Param("id") id: string): RoomSnapshot {
    return this.boardService.getOrCreateRoom(id);
  }

  @Get("rooms/:id")
  getRoom(@Param("id") id: string): RoomSnapshot {
    return this.boardService.getOrCreateRoom(id);
  }

  @Post("rooms/:id/import")
  importRoom(
    @Param("id") id: string,
    @Body() snapshot: ImportedRoomSnapshot,
  ): RoomSnapshot {
    return this.boardService.replaceRoom(id, snapshot);
  }

  @Post("images")
  uploadImage(@Body() body: { dataUrl: string }): { id: string } {
    return this.boardService.storeImage(body.dataUrl);
  }

  @Get("images/:id")
  getImage(@Param("id") id: string, @Res() response: HttpResponse): void {
    const image = this.boardService.getImage(id);
    response.setHeader("Content-Type", image.contentType);
    response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    response.send(image.data);
  }

  @Post("rooms/:id/operations")
  applyOperation(
    @Param("id") id: string,
    @Body() body: { operation: never },
  ): RoomSnapshot {
    return this.boardService.applyClientOperation(id, body.operation);
  }

  @Get("admin/summary")
  getAdminSummary(
    @Headers("x-admin-password") password?: string,
  ): AdminSummary {
    this.assertAdmin(password);
    const rooms = this.boardService.listRooms();
    const memory = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    const now = process.hrtime.bigint();
    const previous = this.lastCpuSample;
    this.lastCpuSample = {
      at: now,
      usage: cpuUsage,
    };

    let cpuPercent: number | null = null;
    if (previous) {
      const cpuMicros =
        cpuUsage.user -
        previous.usage.user +
        cpuUsage.system -
        previous.usage.system;
      const elapsedMicros = Number(now - previous.at) / 1000;
      if (elapsedMicros > 0) {
        cpuPercent = Math.min(
          100,
          (cpuMicros / (elapsedMicros * availableParallelism())) * 100,
        );
      }
    }

    return {
      generatedAt: Date.now(),
      rooms,
      totals: {
        rooms: rooms.length,
        canvases: rooms.reduce((sum, room) => sum + room.canvasCount, 0),
        strokes: rooms.reduce((sum, room) => sum + room.strokeCount, 0),
        images: rooms.reduce((sum, room) => sum + room.imageCount, 0),
        storedImageBytes: this.boardService.getStoredImageBytes(),
      },
      process: {
        pid: process.pid,
        uptimeSeconds: process.uptime(),
        memory,
        cpu: {
          userSeconds: cpuUsage.user / 1_000_000,
          systemSeconds: cpuUsage.system / 1_000_000,
          percent: cpuPercent,
        },
      },
    };
  }

  @Delete("admin/rooms/:id")
  deleteAdminRoom(
    @Param("id") id: string,
    @Headers("x-admin-password") password?: string,
  ): { deleted: boolean } {
    this.assertAdmin(password);
    return {
      deleted: this.boardService.deleteRoom(id),
    };
  }

  private assertAdmin(password?: string): void {
    const expectedPassword = process.env.ADMIN_PASSWORD;
    if (!expectedPassword || password !== expectedPassword) {
      throw new UnauthorizedException("Invalid admin password");
    }
  }
}
