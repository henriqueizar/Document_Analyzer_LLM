import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  Param,
  Body,
  Headers,
  Get,
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
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Headers('user-id') userEmail: string
  ) {
    return this.documentsService.create(userEmail, file);

  }

  @Post(':id/process')
async process(@Param('id') id: string) {
  console.log('PROCESSANDO DOCUMENTO');
  await this.documentsService.process(id); 
  return { message: 'Processing completed' };
}

  @Post(':id/ask')
  async ask(
    @Param('id') id: string,
    @Body('question') question: string,
  ) {
    return this.documentsService.ask(id, question);
  }


@Get(':id')
async findOne(@Param('id') id: string) {
  console.log('GET DOCUMENT:', id);
  return this.documentsService.findOne(id);
}
@Get()
async findAll(@Headers('user-id') userEmail: string) {
  return this.documentsService.findAllByUser(userEmail);
}
}