/*
  Warnings:

  - Added the required column `role` to the `LlmInteraction` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "LlmInteraction" ADD COLUMN     "role" TEXT NOT NULL;
