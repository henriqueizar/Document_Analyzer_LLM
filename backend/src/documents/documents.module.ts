import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { OcrModule } from '../ocr/ocr.module';
import { LlmModule } from '../llm/llm.module';

@Module({
  imports: [OcrModule, LlmModule],
  controllers: [DocumentsController],
  providers: [DocumentsService]
})
export class DocumentsModule {}
