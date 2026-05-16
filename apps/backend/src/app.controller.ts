import { Body, Controller, Get, Param, Post, Res } from "@nestjs/common";
import { BoardService } from "./board.service";
import { ImportedRoomSnapshot, RoomSnapshot } from "./board.types";

interface HttpResponse {
  setHeader(name: string, value: string): void;
  send(body: Buffer): void;
}

@Controller()
export class AppController {
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
  importRoom(@Param("id") id: string, @Body() snapshot: ImportedRoomSnapshot): RoomSnapshot {
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
  applyOperation(@Param("id") id: string, @Body() body: { operation: never }): RoomSnapshot {
    return this.boardService.applyClientOperation(id, body.operation);
  }
}
