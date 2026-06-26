/*
  Warnings:

  - You are about to drop the column `created_at` on the `inventory` table. All the data in the column will be lost.
  - You are about to drop the column `updated_at` on the `inventory` table. All the data in the column will be lost.
  - You are about to drop the column `created_at` on the `reservation` table. All the data in the column will be lost.
  - You are about to drop the column `updated_at` on the `reservation` table. All the data in the column will be lost.
  - Added the required column `updatedAt` to the `inventory` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `reservation` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "FolioStatus" AS ENUM ('OPEN', 'CLOSED', 'SETTLED');

-- CreateEnum
CREATE TYPE "FolioChargeType" AS ENUM ('ROOM', 'MEAL', 'ANCILLARY', 'PENALTY', 'MANUAL');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'BANK_TRANSFER', 'OTA_PASSTHRU');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('PAYMENT', 'DEPOSIT', 'REFUND');

-- CreateEnum
CREATE TYPE "HkTaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'DONE', 'INSPECTED');

-- CreateEnum
CREATE TYPE "HkTaskType" AS ENUM ('CLEANING', 'TURNDOWN', 'INSPECTION', 'MAINTENANCE', 'DEEP_CLEAN');

-- DropForeignKey
ALTER TABLE "inventory" DROP CONSTRAINT "inventory_room_type_id_fkey";

-- DropForeignKey
ALTER TABLE "reservation" DROP CONSTRAINT "reservation_room_id_fkey";

-- DropIndex
DROP INDEX "reservation_tenant_room_place_dates_idx";

-- AlterTable
ALTER TABLE "inventory" DROP COLUMN "created_at",
DROP COLUMN "updated_at",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now();

-- AlterTable
ALTER TABLE "reservation" DROP COLUMN "created_at",
DROP COLUMN "updated_at",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now();

-- CreateTable
CREATE TABLE "folio" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "reservation_id" UUID NOT NULL,
    "status" "FolioStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now(),

    CONSTRAINT "folio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "folio_charge" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "folio_id" UUID NOT NULL,
    "type" "FolioChargeType" NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(8,2) NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "added_by" UUID,

    CONSTRAINT "folio_charge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "folio_id" UUID NOT NULL,
    "type" "PaymentType" NOT NULL DEFAULT 'PAYMENT',
    "method" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "amount" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "received_by" UUID,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "housekeeping_task" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "type" "HkTaskType" NOT NULL DEFAULT 'CLEANING',
    "status" "HkTaskStatus" NOT NULL DEFAULT 'PENDING',
    "assignee_id" UUID,
    "created_from_reservation_id" UUID,
    "notes" TEXT,
    "completed_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now(),

    CONSTRAINT "housekeeping_task_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "folio_reservation_id_key" ON "folio"("reservation_id");

-- CreateIndex
CREATE INDEX "folio_tenant_id_idx" ON "folio"("tenant_id");

-- CreateIndex
CREATE INDEX "folio_reservation_id_idx" ON "folio"("reservation_id");

-- CreateIndex
CREATE INDEX "folio_charge_tenant_id_idx" ON "folio_charge"("tenant_id");

-- CreateIndex
CREATE INDEX "folio_charge_folio_id_idx" ON "folio_charge"("folio_id");

-- CreateIndex
CREATE INDEX "payment_tenant_id_idx" ON "payment"("tenant_id");

-- CreateIndex
CREATE INDEX "payment_folio_id_idx" ON "payment"("folio_id");

-- CreateIndex
CREATE INDEX "housekeeping_task_tenant_id_idx" ON "housekeeping_task"("tenant_id");

-- CreateIndex
CREATE INDEX "housekeeping_task_tenant_id_status_idx" ON "housekeeping_task"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "housekeeping_task_room_id_idx" ON "housekeeping_task"("room_id");

-- CreateIndex
CREATE INDEX "housekeeping_task_assignee_id_idx" ON "housekeeping_task"("assignee_id");

-- CreateIndex
CREATE INDEX "reservation_tenant_id_room_id_check_in_check_out_idx" ON "reservation"("tenant_id", "room_id", "check_in", "check_out");

-- AddForeignKey
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_room_type_id_fkey" FOREIGN KEY ("room_type_id") REFERENCES "room_type"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folio_charge" ADD CONSTRAINT "folio_charge_folio_id_fkey" FOREIGN KEY ("folio_id") REFERENCES "folio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_folio_id_fkey" FOREIGN KEY ("folio_id") REFERENCES "folio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "housekeeping_task" ADD CONSTRAINT "housekeeping_task_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "housekeeping_task" ADD CONSTRAINT "housekeeping_task_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "reservation_tenant_dates_idx" RENAME TO "reservation_tenant_id_check_in_check_out_idx";

-- RenameIndex
ALTER INDEX "reservation_tenant_status_idx" RENAME TO "reservation_tenant_id_status_idx";
