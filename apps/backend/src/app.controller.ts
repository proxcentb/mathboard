import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { BoardService } from "./board.service";
import { RoomSnapshot } from "./board.types";

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

  @Post("rooms/:id/operations")
  applyOperation(@Param("id") id: string, @Body() body: { operation: never }): RoomSnapshot {
    return this.boardService.applyClientOperation(id, body.operation);
  }
}
