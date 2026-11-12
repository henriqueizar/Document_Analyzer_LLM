import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AdminGuard, AuthGuard, type AuthUser } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { TeamsService } from './teams.service';

@Controller('teams')
@UseGuards(AuthGuard)
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  /** Teams of the current user (any user): decides whether sharing is offered. */
  @Get('mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.teams.mine(user.id);
  }

  @Get()
  @UseGuards(AdminGuard)
  list() {
    return this.teams.list();
  }

  @Post()
  @UseGuards(AdminGuard)
  create(@Body('name') name: unknown) {
    return this.teams.create(name);
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  rename(@Param('id') id: string, @Body('name') name: unknown) {
    return this.teams.rename(id, name);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    await this.teams.remove(id);
  }

  @Post(':id/members')
  @UseGuards(AdminGuard)
  @HttpCode(204)
  async addMember(@Param('id') id: string, @Body('userId') userId: unknown) {
    await this.teams.addMember(id, userId);
  }

  @Delete(':id/members/:userId')
  @UseGuards(AdminGuard)
  @HttpCode(204)
  async removeMember(@Param('id') id: string, @Param('userId') userId: string) {
    await this.teams.removeMember(id, userId);
  }
}
