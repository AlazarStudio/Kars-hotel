-- ПИТАНИЕ ПРИ БРОНИ — ПО ДНЯМ.
--
-- Оператор заказывает экипажу завтраки, обеды и ужины, и до сих пор эта
-- раскладка жила только у него: гостиница узнавала о ней голосом или из
-- комментария к брони свободным текстом. Считали её обе стороны по своим
-- правилам, и расхождение всплывало в акте, когда спорить уже поздно.
--
-- ПОЧЕМУ ПО ДНЯМ, А НЕ ОДНИМ ПРИЗНАКОМ У БРОНИ. Набор приёмов меняется внутри
-- одного заезда: в день заезда завтрака не будет, если борт сел в полдень, а в
-- день выезда не будет ужина. Флаг «питание включено» этого не выражает, и
-- гостиница всё равно считала бы дни сама — то есть второй раз и по-своему.
--
-- ПОЧЕМУ КОЛИЧЕСТВО, А НЕ «ДА/НЕТ». В номере живут двое, а завтрак заказан
-- одному; экипаж уезжает частями. Порции — то, что гостиница готовит и за что
-- выставляет счёт, и хранить надо именно их.
--
-- ТАРИФНОГО ПЛАНА ЭТО НЕ ОТМЕНЯЕТ. У брони есть `rate_plan_id`, и питание
-- может входить в тариф (BB, HB, FB). Здесь — ЗАКАЗ оператора: сколько порций
-- он просит на каждый день. Что из этого уже оплачено тарифом, а что идёт
-- сверх, решает расчёт, а не эта таблица.

CREATE TABLE IF NOT EXISTS "reservation_meal_day" (
  "id"             TEXT PRIMARY KEY,
  "tenant_id"      UUID NOT NULL,
  "reservation_id" UUID NOT NULL REFERENCES "reservation"("id") ON DELETE CASCADE,
  "date"           DATE NOT NULL,
  "breakfast"      INTEGER NOT NULL DEFAULT 0,
  "lunch"          INTEGER NOT NULL DEFAULT 0,
  "dinner"         INTEGER NOT NULL DEFAULT 0,
  "updated_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- День у брони один: присланная раскладка заменяет прежнюю целиком, а не
-- копится слоями. Повторная отправка тех же данных ничего не меняет.
CREATE UNIQUE INDEX IF NOT EXISTS "reservation_meal_day_key"
  ON "reservation_meal_day" ("reservation_id", "date");
CREATE INDEX IF NOT EXISTS "reservation_meal_day_tenant_idx"
  ON "reservation_meal_day" ("tenant_id");
-- Отбор «что готовить завтра» идёт по гостинице и дню, а не по брони.
CREATE INDEX IF NOT EXISTS "reservation_meal_day_date_idx"
  ON "reservation_meal_day" ("tenant_id", "date");

-- Изоляция арендаторов — как у всех тенантных таблиц: чужую раскладку
-- гостиница не видит, даже зная идентификатор брони.
ALTER TABLE "reservation_meal_day" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reservation_meal_day" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "reservation_meal_day";
CREATE POLICY tenant_isolation ON "reservation_meal_day"
  AS PERMISSIVE FOR ALL
  TO app_user
  USING (
    tenant_id IS NOT NULL
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  )
  WITH CHECK (
    tenant_id IS NOT NULL
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );
