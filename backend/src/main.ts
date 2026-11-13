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

  // Security headers on every API response (the API serves data, never pages).
  const http = app.getHttpAdapter().getInstance();
  http.disable('x-powered-by');
  http.use(
    (
      _req: unknown,
      res: { setHeader(name: string, value: string): void },
      next: () => void,
    ) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; frame-ancestors 'none'",
      );
      res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
      next();
    },
  );

  // Only this machine by default; the Docker image sets HOST=0.0.0.0 so the
  // proxy and the web server reach it on the isolated network.
  await app.listen(
    Number(process.env.PORT) || 3000,
    process.env.HOST || '127.0.0.1',
  );
}
bootstrap();
