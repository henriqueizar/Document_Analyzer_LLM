import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
import { normalizeFileName } from '../common/file-names';
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
      // File names arrive as UTF-8 (multer's default would read them as Latin-1).
      defParamCharset: 'utf8',
      limits: { fileSize: MAX_UPLOAD_BYTES },
      fileFilter: (_, file, cb) => {
        file.originalname = normalizeFileName(file.originalname);
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

  /** Read again and re-explain, in the background (202: queued). */
  @Post(':id/process')
  @HttpCode(202)
  process(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.documentsService.process(id, user.email);
  }

  /** Write the automatic explanation again, in the background. */
  @Post(':id/explain')
  @HttpCode(202)
  explain(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.documentsService.explain(id, user.email);
  }

  @Post(':id/ask')
  async ask(
    @Param('id') id: string,
    @Body('question') question: string,
    @Body('interpret') interpret: unknown,
    @CurrentUser() user: AuthUser,
  ) {
    // interpretation only when explicitly requested; answers in the user's language
    return this.documentsService.ask(id, question, user.email, interpret === true, user.language);
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

  /** Translation of an explanation or answer into the given language (stored). */
  @Post(':id/interactions/:interactionId/translate')
  @HttpCode(200)
  translate(
    @Param('id') id: string,
    @Param('interactionId') interactionId: string,
    @Body('to') to: unknown,
    @CurrentUser() user: AuthUser,
  ) {
    return this.documentsService.translate(id, interactionId, user.email, to);
  }

  /** Permanently deletes the document, its file and all its interactions. */
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.documentsService.remove(id, user.email);
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
