import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  Param,
  Body,
  Headers,
  Get,
  BadRequestException,
} from '@nestjs/common';

import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';

import { DocumentsService } from './documents.service';
import { isSupportedUpload } from '../common/supported-files';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

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
          cb(null, uniqueSuffix + extname(file.originalname).toLowerCase());
        },
      }),
      limits: { fileSize: MAX_UPLOAD_BYTES },
      fileFilter: (_, file, cb) => {
        if (isSupportedUpload(file.originalname, file.mimetype)) {
          cb(null, true);
        } else {
          cb(
            new BadRequestException(
              'Unsupported file type. Upload a PDF or an image (png, jpg, jpeg, webp, bmp, tiff).',
            ),
            false,
          );
        }
      },
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Headers('user-id') userEmail: string
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded (expected form field "file").');
    }
    return this.documentsService.create(userEmail, file);

  }

  @Post(':id/process')
async process(@Param('id') id: string) {
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
  return this.documentsService.findOne(id);
}
@Get()
async findAll(@Headers('user-id') userEmail: string) {
  return this.documentsService.findAllByUser(userEmail);
}
}