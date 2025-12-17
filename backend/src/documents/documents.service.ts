import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
@Injectable()
export class DocumentsService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, file: Express.Multer.File) {
    return this.prisma.document.create({
      data: {
        userId,
        filename: file.filename,
        originalName: file.originalname, 
        filePath: file.path,
        status: 'PENDING',
      },
    });
  }
}