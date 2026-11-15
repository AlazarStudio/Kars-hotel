-- A hotel can prepare the next contract before the current one expires.
-- Active scopes are unique WITHIN a contract; an explicit ratePlanId resolves
-- overlaps between different contracts at booking time. The previous index
-- already prevents duplicates within a contract, so this only relaxes its scope.
BEGIN;
UPDATE "rate_plan"
SET "operator_contract" = NULLIF(BTRIM("operator_contract"), '')
WHERE "operator_contract" IS DISTINCT FROM NULLIF(BTRIM("operator_contract"), '');

DROP INDEX "rate_plan_partner_scope_key";
CREATE UNIQUE INDEX "rate_plan_partner_scope_key"
  ON "rate_plan" ("tenant_id", "partner_id", "operator_contract", "partner_account_id", "partner_customer_id", "guest_kind", "meal_plan")
  NULLS NOT DISTINCT
  WHERE "partner_id" IS NOT NULL AND "is_active";
COMMIT;
