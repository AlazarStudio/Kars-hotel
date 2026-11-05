-- ЦЕНА ПИТАНИЯ В ТАРИФЕ (5.3, тестирование 04.11.2026).
--
-- Питание тарифа было только ярлыком meal_plan (BB/HB/FB/AI): цену питания
-- завести было негде, «всё включено» не говорило, что включено. Теперь:
--   meal_included        — питание в цене номера (по умолчанию да: так
--                          понимались все прежние тарифы с питанием);
--   meal_price_breakfast/lunch/dinner — цена на гостя за приём пищи, рубли;
--   meal_price_per_day   — или одной суммой за сутки на гостя, рубли;
--   all_inclusive_note   — что входит во «всё включено».
--
-- Только новые колонки с умолчанием/NULL: существующие тарифы не меняются.
-- Откат — удалить колонки.

ALTER TABLE "rate_plan"
  ADD COLUMN "meal_included" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "meal_price_breakfast" INTEGER,
  ADD COLUMN "meal_price_lunch" INTEGER,
  ADD COLUMN "meal_price_dinner" INTEGER,
  ADD COLUMN "meal_price_per_day" INTEGER,
  ADD COLUMN "all_inclusive_note" TEXT;
