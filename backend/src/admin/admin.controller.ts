import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard, AuthGuard, type AuthUser } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
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
    @CurrentUser() user: AuthUser,
  ) {
    await this.admin.removeShare(teamId, documentId, user.email);
  }

  /** Activity log, newest first: ?actor=<e-mail>&action=<ACTION>&limit=<n>. */
  @Get('audit')
  audit(
    @Query('actor') actor?: string,
    @Query('action') action?: string,
    @Query('limit') limit?: string,
  ) {
    return this.admin.auditLog({ actor, action, limit });
  }
}
