import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { BoardGateway } from "./board.gateway";
import { BoardService } from "./board.service";

@Module({
  imports: [],
  controllers: [AppController],
  providers: [BoardGateway, BoardService]
})
export class AppModule {}
