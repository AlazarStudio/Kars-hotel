-- CreateEnum
CREATE TYPE "MealPlan" AS ENUM ('NONE', 'BB', 'HB', 'FB', 'AI');

-- CreateEnum
CREATE TYPE "PriceModifierType" AS ENUM ('ABSOLUTE', 'PERCENT');

-- CreateTable
CREATE TABLE "cancellation_policy" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "free_cancel_hours_before" INTEGER NOT NULL DEFAULT 24,
    "penalty_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "penalty_nights" INTEGER NOT NULL DEFAULT 0,
    "non_refundable" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cancellation_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_policy" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prepayment_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "prepayment_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "prepayment_deadline_hours" INTEGER NOT NULL DEFAULT 0,
    "payment_on_arrival" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_plan" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "meal_plan" "MealPlan" NOT NULL DEFAULT 'NONE',
    "occupancy_pricing" BOOLEAN NOT NULL DEFAULT false,
    "parent_rate_plan_id" UUID,
    "price_modifier_type" "PriceModifierType" NOT NULL DEFAULT 'PERCENT',
    "price_modifier_value" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "cancellation_policy_id" UUID,
    "payment_policy_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "rate_plan_id" UUID NOT NULL,
    "room_type_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "occupancy" INTEGER NOT NULL DEFAULT 2,
    "price" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restriction" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "rate_plan_id" UUID,
    "room_type_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "cta" BOOLEAN NOT NULL DEFAULT false,
    "ctd" BOOLEAN NOT NULL DEFAULT false,
    "stop_sell" BOOLEAN NOT NULL DEFAULT false,
    "min_los" INTEGER,
    "max_los" INTEGER,
    "min_los_arrival" INTEGER,
    "max_los_arrival" INTEGER,
    "min_advance" INTEGER,
    "max_advance" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "restriction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cancellation_policy_tenant_id_idx" ON "cancellation_policy"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "cancellation_policy_tenant_id_code_key" ON "cancellation_policy"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "payment_policy_tenant_id_idx" ON "payment_policy"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_policy_tenant_id_code_key" ON "payment_policy"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "rate_plan_tenant_id_idx" ON "rate_plan"("tenant_id");

-- CreateIndex
CREATE INDEX "rate_plan_parent_rate_plan_id_idx" ON "rate_plan"("parent_rate_plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "rate_plan_tenant_id_code_key" ON "rate_plan"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "rate_tenant_id_idx" ON "rate"("tenant_id");

-- CreateIndex
CREATE INDEX "rate_rate_plan_id_room_type_id_date_idx" ON "rate"("rate_plan_id", "room_type_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "rate_tenant_id_rate_plan_id_room_type_id_date_occupancy_key" ON "rate"("tenant_id", "rate_plan_id", "room_type_id", "date", "occupancy");

-- CreateIndex
CREATE INDEX "restriction_tenant_id_idx" ON "restriction"("tenant_id");

-- CreateIndex
CREATE INDEX "restriction_room_type_id_date_idx" ON "restriction"("room_type_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "restriction_tenant_id_rate_plan_id_room_type_id_date_key" ON "restriction"("tenant_id", "rate_plan_id", "room_type_id", "date");

-- AddForeignKey
ALTER TABLE "rate_plan" ADD CONSTRAINT "rate_plan_parent_rate_plan_id_fkey" FOREIGN KEY ("parent_rate_plan_id") REFERENCES "rate_plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_plan" ADD CONSTRAINT "rate_plan_cancellation_policy_id_fkey" FOREIGN KEY ("cancellation_policy_id") REFERENCES "cancellation_policy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_plan" ADD CONSTRAINT "rate_plan_payment_policy_id_fkey" FOREIGN KEY ("payment_policy_id") REFERENCES "payment_policy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate" ADD CONSTRAINT "rate_rate_plan_id_fkey" FOREIGN KEY ("rate_plan_id") REFERENCES "rate_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restriction" ADD CONSTRAINT "restriction_rate_plan_id_fkey" FOREIGN KEY ("rate_plan_id") REFERENCES "rate_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
