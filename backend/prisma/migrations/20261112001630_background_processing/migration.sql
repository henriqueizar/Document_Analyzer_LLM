-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "explanationError" TEXT,
ADD COLUMN     "explanationStatus" "DocumentStatus",
ADD COLUMN     "failureReason" TEXT;
