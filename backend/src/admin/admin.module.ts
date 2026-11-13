import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [LlmModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
