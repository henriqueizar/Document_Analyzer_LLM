import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AdminGuard, AuthGuard } from '../auth/auth.guard';
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
  create(@Body() body: NewUser) {
    return this.users.create(body);
  }

  @Post(':id/password')
  resetPassword(@Param('id') id: string, @Body() body: { password?: string }) {
    return this.users.resetPassword(id, body.password);
  }
}
