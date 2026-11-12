import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DocumentsModule } from './documents/documents.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { TeamsModule } from './teams/teams.module';
import { AdminModule } from './admin/admin.module';

// Uploaded files are no longer served statically: they are only available to
// their owner through the authenticated GET /documents/:id/file route.
@Module({
  imports: [PrismaModule, AuthModule, UsersModule, TeamsModule, AdminModule, DocumentsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
