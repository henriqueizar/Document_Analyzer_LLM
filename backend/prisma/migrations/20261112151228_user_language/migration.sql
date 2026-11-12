-- AlterTable
ALTER TABLE "LlmInteraction" ADD COLUMN     "language" TEXT,
ADD COLUMN     "translations" JSONB;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "language" TEXT NOT NULL DEFAULT 'pt';
