/**
 * Sets a temporary password for an account, from the server's terminal: the
 * way back when the only administrator forgets their password. Whoever can run
 * this already controls the machine, so it needs no other authorisation.
 *
 *   development:  npm run reset-password -- admin@empresa.com
 *   installation: cd deploy && ./reset-password.sh admin@empresa.com
 *
 * Recorded in the activity log. The person signs in with the temporary
 * password and changes it under "Account".
 */
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';
import { hashPassword } from '../auth/password';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function temporaryPassword(): string {
  const chars = Array.from(
    randomBytes(16),
    (b) => ALPHABET[b % ALPHABET.length],
  ).join('');
  return chars.match(/.{4}/g)!.join('-');
}

async function main() {
  try {
    process.loadEnvFile();
  } catch {
    // no .env file: the environment has the settings (Docker)
  }
  const email = (process.argv[2] ?? '').trim().toLowerCase();
  if (!email) {
    console.error('Uso: reset-password <e-mail>');
    process.exit(2);
  }
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      const admins = await prisma.user.findMany({
        where: { role: 'ADMIN' },
        select: { email: true },
      });
      console.error(`Nenhuma conta com o e-mail ${email}.`);
      if (admins.length)
        console.error(
          `Administradores: ${admins.map((a) => a.email).join(', ')}`,
        );
      process.exit(1);
    }
    const password = temporaryPassword();
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(password) },
    });
    await prisma.auditEvent.create({
      data: {
        actorEmail: 'server-console',
        action: 'PASSWORD_RESET',
        target: email,
        details: { via: 'reset-password command' },
      },
    });
    console.log(`Senha temporária de ${email}: ${password}`);
    console.log('Entre com ela e troque a senha em "Conta".');
    console.log(
      'Se a conta estiver bloqueada por tentativas erradas, espere 15 minutos ou reinicie o backend.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();
