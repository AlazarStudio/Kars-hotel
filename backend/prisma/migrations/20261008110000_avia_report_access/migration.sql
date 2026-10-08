-- ПРАВО НА ОТЧЁТЫ KARS AVIA (08.10.2026, 152-ФЗ, Р-44, решение владельца 13;
-- план 13.5).
--
-- Отчёт, выпущенный Kars Avia для гостиницы, несёт ФИО гостей и суммы, а
-- открывался правом report.view.operations — оно у пяти ролей, включая
-- «Только просмотр» и службу приёма. Теперь своё право, и только у
-- владельца, менеджера и бухгалтера (у всех гостиниц сразу). Каталог прав
-- приложение синхронизирует при запуске — здесь право заводится заранее,
-- чтобы его можно было выдать ролям уже существующих гостиниц.
INSERT INTO "permission" ("id", "code", "name")
SELECT gen_random_uuid(), 'avia-report.access', 'Отчёты Kars Avia (ФИО гостей)'
 WHERE NOT EXISTS (SELECT 1 FROM "permission" WHERE "code" = 'avia-report.access');

INSERT INTO "role_permission" ("role_id", "permission_id")
SELECT r."id", p."id"
  FROM "role" r
  JOIN "permission" p ON p."code" = 'avia-report.access'
 WHERE r."code" IN ('OWNER', 'MANAGER', 'ACCOUNTANT')
   AND NOT EXISTS (
     SELECT 1 FROM "role_permission" rp WHERE rp."role_id" = r."id" AND rp."permission_id" = p."id"
   );
