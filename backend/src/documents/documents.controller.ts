import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  Param
} from '@nestjs/common';

import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';

import { DocumentsService } from './documents.service';

@Controller('documents')
export class DocumentsController {

  constructor(
    private readonly documentsService: DocumentsService, 
  ) {}


  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads',
        filename: (_, file, cb) => {
          const uniqueSuffix =
            Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(null, uniqueSuffix + extname(file.originalname));
        },
      }),
    }),
  )
  upload(@UploadedFile() file: Express.Multer.File) {
    const userId = 'test-user'; // temporario, dps vem o auth
    return this.documentsService.create(userId, file);
  }

  @Post(':id/process')
async process(@Param('id') id: string) {
  this.documentsService.process(id); // sem await
  return { message: 'Processing started' };
  }
}