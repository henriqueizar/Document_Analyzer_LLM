import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';

import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { createReadStream } from 'fs';

import { DocumentsService } from './documents.service';
import { isSupportedUpload } from '../common/supported-files';
import { AuthGuard, type AuthUser } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

@Controller('documents')
@UseGuards(AuthGuard)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

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
    @CurrentUser() user: AuthUser,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded (expected form field "file").');
    }
    return this.documentsService.create(user.email, file);
  }

  @Post(':id/process')
  async process(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.documentsService.process(id, user.email);
    return { message: 'Processing completed' };
  }

  @Post(':id/ask')
  async ask(
    @Param('id') id: string,
    @Body('question') question: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.documentsService.ask(id, question, user.email);
  }

  /** Authenticated replacement for the old public /uploads static route. */
  @Get(':id/file')
  async file(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const { path, mimeType } = await this.documentsService.getFile(id, user.email);
    return new StreamableFile(createReadStream(path), {
      type: mimeType,
      disposition: 'inline',
    });
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.documentsService.findOne(id, user.email);
  }

  @Get()
  async findAll(@CurrentUser() user: AuthUser) {
    return this.documentsService.findAllByUser(user.email);
  }
}
