-- CreateEnum
CREATE TYPE "BedType" AS ENUM ('SINGLE', 'DOUBLE', 'TWIN', 'KING', 'QUEEN', 'SOFA');

-- CreateEnum
CREATE TYPE "RoomView" AS ENUM ('NONE', 'CITY', 'GARDEN', 'POOL', 'SEA', 'MOUNTAIN', 'COURTYARD');

-- CreateEnum
CREATE TYPE "RoomStatus" AS ENUM ('DIRTY', 'CLEANING', 'INSPECTED', 'CLEAN', 'READY', 'OUT_OF_ORDER', 'OUT_OF_SERVICE');

-- CreateTable
CREATE TABLE "room_type" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "base_occupancy" INTEGER NOT NULL DEFAULT 2,
    "max_occupancy" INTEGER NOT NULL DEFAULT 2,
    "extra_beds" INTEGER NOT NULL DEFAULT 0,
    "base_price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "photos" JSONB,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "room_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "room_type_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "floor" INTEGER NOT NULL DEFAULT 1,
    "bed_type" "BedType" NOT NULL DEFAULT 'DOUBLE',
    "view" "RoomView" NOT NULL DEFAULT 'NONE',
    "status" "RoomStatus" NOT NULL DEFAULT 'CLEAN',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "room_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "room_type_tenant_id_idx" ON "room_type"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "room_type_tenant_id_code_key" ON "room_type"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "room_tenant_id_idx" ON "room"("tenant_id");

-- CreateIndex
CREATE INDEX "room_room_type_id_idx" ON "room"("room_type_id");

-- CreateIndex
CREATE INDEX "room_status_idx" ON "room"("status");

-- CreateIndex
CREATE UNIQUE INDEX "room_tenant_id_number_key" ON "room"("tenant_id", "number");

-- AddForeignKey
ALTER TABLE "room" ADD CONSTRAINT "room_room_type_id_fkey" FOREIGN KEY ("room_type_id") REFERENCES "room_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
