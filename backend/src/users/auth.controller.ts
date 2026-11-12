import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthUser } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { UsersService } from './users.service';
import { defaultLanguage } from '../common/language';

/**
 * Local accounts. No external identity provider: e-mail + password, stored as
 * a scrypt hash in the local database.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly users: UsersService) {}

  /** Public: tells the frontend whether to show the first-run setup screen. */
  @Get('setup')
  async setupStatus() {
    // defaultLanguage: language of the screens shown before signing in
    return { needsSetup: await this.users.needsSetup(), defaultLanguage: defaultLanguage() };
  }

  /** Public, only while no administrator exists. */
  @Post('setup')
  createAdmin(@Body() body: { name?: string; email?: string; password?: string; language?: string }) {
    return this.users.createFirstAdmin(body);
  }

  /** Public: called by the frontend server (NextAuth credentials) to check a password. */
  @Post('login')
  @HttpCode(200)
  login(@Body() body: { email?: string; password?: string }) {
    return this.users.authenticate(body.email, body.password);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return this.users.me(user.email);
  }

  /** Interface and LLM language of the current user. */
  @Post('me/language')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  setLanguage(@CurrentUser() user: AuthUser, @Body() body: { language?: string }) {
    return this.users.setLanguage(user.email, body.language);
  }

  /** The user read the privacy notice shown after the first login. */
  @Post('me/privacy')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  acceptPrivacy(@CurrentUser() user: AuthUser) {
    return this.users.acceptPrivacyNotice(user.email);
  }

  @Post('me/password')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() body: { currentPassword?: string; newPassword?: string },
  ) {
    await this.users.changeOwnPassword(user.email, body.currentPassword, body.newPassword);
  }
}
