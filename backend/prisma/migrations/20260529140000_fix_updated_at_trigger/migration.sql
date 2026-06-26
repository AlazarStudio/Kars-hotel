-- The shared set_updated_at() trigger function still referenced the legacy
-- snake_case column NEW.updated_at. The 20260529135124_folio_housekeeping
-- migration renamed reservation/inventory timestamp columns to camelCase
-- ("createdAt"/"updatedAt") to match the Prisma schema, which broke every
-- UPDATE on those two tables (Postgres 42703: record "new" has no field
-- "updated_at"). Point the function at the current column name.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."updatedAt" = now();
  RETURN NEW;
END;
$$;
