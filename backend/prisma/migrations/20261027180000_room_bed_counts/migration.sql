-- КРОВАТИ НОМЕРА ЧИСЛАМИ (27.10.2026, просьба гостиниц).
--
-- Вид кровати выбирался из одного списка, и сочетаний не хватало: «двуспальная
-- и диван», «две односпальные и диван» и так далее. Теперь у номера четыре
-- числа: односпальных, двуспальных, диванов и доп. кроватей. Доп. кровати
-- переезжают к номеру из категории: в одной категории они есть не у всех.
--
-- Существующие номера переносятся из прежнего вида. King-size и Queen-size —
-- двуспальные кровати по размеру, поэтому одна двуспальная; сам вид остаётся
-- в bed_type, этот столбец не меняется. Доп. кровати категории номерам НЕ
-- раздаются: число у категории — «можно поставить», а не «стоит в каждом».
ALTER TABLE "room"
  ADD COLUMN "single_beds" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "double_beds" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "sofas" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "extra_beds" INTEGER NOT NULL DEFAULT 0;

UPDATE "room" SET
  "single_beds" = CASE "bed_type"
    WHEN 'SINGLE' THEN 1 WHEN 'TWIN' THEN 2 WHEN 'THREE_SINGLE' THEN 3
    WHEN 'FOUR_SINGLE' THEN 4 WHEN 'FIVE_SINGLE' THEN 5 WHEN 'DOUBLE_SINGLE' THEN 1
    ELSE 0 END,
  "double_beds" = CASE "bed_type"
    WHEN 'DOUBLE' THEN 1 WHEN 'KING' THEN 1 WHEN 'QUEEN' THEN 1
    WHEN 'TWO_DOUBLE' THEN 2 WHEN 'DOUBLE_SINGLE' THEN 1
    ELSE 0 END,
  "sofas" = CASE "bed_type" WHEN 'SOFA' THEN 1 ELSE 0 END;
