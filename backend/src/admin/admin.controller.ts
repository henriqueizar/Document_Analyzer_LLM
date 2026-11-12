import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard, AuthGuard } from '../auth/auth.guard';
import { AdminService } from './admin.service';

@Controller('admin')
@UseGuards(AuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('overview')
  overview() {
    return this.admin.overview();
  }

  @Delete('teams/:teamId/documents/:documentId')
  @HttpCode(204)
  async removeShare(
    @Param('teamId') teamId: string,
    @Param('documentId') documentId: string,
  ) {
    await this.admin.removeShare(teamId, documentId);
  }
}
