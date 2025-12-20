/*
  Warnings:

  - You are about to drop the column `content` on the `LlmInteraction` table. All the data in the column will be lost.
  - You are about to drop the column `role` on the `LlmInteraction` table. All the data in the column will be lost.
  - Added the required column `answer` to the `LlmInteraction` table without a default value. This is not possible if the table is not empty.
  - Added the required column `question` to the `LlmInteraction` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "LlmInteraction" DROP COLUMN "content",
DROP COLUMN "role",
ADD COLUMN     "answer" TEXT NOT NULL,
ADD COLUMN     "question" TEXT NOT NULL;
