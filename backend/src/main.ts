import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // No seu main.ts
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads', 
    index: false,       // nao busca index.html
});
  app.enableCors();

  await app.listen(3000);
}
bootstrap();