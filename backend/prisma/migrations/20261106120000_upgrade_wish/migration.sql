-- 5.10 · Пассажир партнёра просит номер выше; предложение гостиницы хранится у брони.
ALTER TABLE "reservation" ADD COLUMN "upgrade_wish" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "reservation" ADD COLUMN "upgrade_offer" JSONB;
