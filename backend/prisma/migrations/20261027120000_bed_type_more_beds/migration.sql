-- БОЛЬШЕ ДВУХ КРОВАТЕЙ В НОМЕРЕ (27.10.2026, просьба гостиницы).
--
-- В номерном фонде кровать выбиралась из шести вариантов, и больше двух
-- кроватей указать было нельзя. Добавлены: три, четыре и пять односпальных,
-- две двуспальные, двуспальная и односпальная. Это только описание номера:
-- вместимость по-прежнему задаёт поле capacity, на расчёт и продажу вид
-- кровати не влияет.
ALTER TYPE "BedType" ADD VALUE IF NOT EXISTS 'THREE_SINGLE' AFTER 'TWIN';
ALTER TYPE "BedType" ADD VALUE IF NOT EXISTS 'FOUR_SINGLE' AFTER 'THREE_SINGLE';
ALTER TYPE "BedType" ADD VALUE IF NOT EXISTS 'FIVE_SINGLE' AFTER 'FOUR_SINGLE';
ALTER TYPE "BedType" ADD VALUE IF NOT EXISTS 'TWO_DOUBLE' AFTER 'FIVE_SINGLE';
ALTER TYPE "BedType" ADD VALUE IF NOT EXISTS 'DOUBLE_SINGLE' AFTER 'TWO_DOUBLE';
