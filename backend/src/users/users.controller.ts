import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard, AuthGuard, type AuthUser } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { UsersService } from './users.service';
import type { NewUser } from './users.service';

/** User management: administrators only. */
@Controller('users')
@UseGuards(AuthGuard, AdminGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list() {
    return this.users.list();
  }

  @Post()
  create(@Body() body: NewUser, @CurrentUser() user: AuthUser) {
    return this.users.create(body, user.email);
  }

  @Post(':id/password')
  resetPassword(
    @Param('id') id: string,
    @Body() body: { password?: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.users.resetPassword(id, body.password, user.email);
  }

  /**
   * Deletes an account. Body: { adminPassword, documents: "delete" | "transfer",
   * transferTo?: userId }.
   */
  @Delete(':id')
  remove(
    @Param('id') id: string,
    @Body()
    body: {
      adminPassword?: unknown;
      documents?: unknown;
      transferTo?: unknown;
    },
    @CurrentUser() user: AuthUser,
  ) {
    return this.users.remove(id, user.email, body);
  }
}
