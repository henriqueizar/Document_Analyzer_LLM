import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { checkDestinations } from './common/destinations';
import { AppModule } from './app.module';
import { getJwtSecret } from './auth/auth.constants';

// Load backend/.env (Node >= 20.12). Real environment variables take precedence.
try {
  process.loadEnvFile();
} catch {
  // no .env file: rely on the process environment
}

async function bootstrap() {
  getJwtSecret(); // fail fast when BACKEND_JWT_SECRET is missing or weak
  // Content must not leave the machine by a configuration mistake.
  const logger = new Logger('Destinations');
  try {
    await checkDestinations(process.env, (message) => logger.warn(message));
  } catch (error) {
    logger.error((error as Error).message);
    process.exit(1);
  }

  const app = await NestFactory.create(AppModule);

  // Only the frontend may call the API from a browser.
  const allowedOrigins = (
    process.env.FRONTEND_ORIGIN ?? 'http://localhost:3001'
  )
    .split(',')
    .map((origin) => origin.trim());
  app.enableCors({ origin: allowedOrigins });

  await app.listen(Number(process.env.PORT) || 3000);
}
bootstrap();
