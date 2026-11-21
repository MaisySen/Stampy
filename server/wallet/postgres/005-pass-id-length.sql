-- Repair migration. The first two migrations limited pass serials to
-- 22 to 80 characters, but the app sends pass ids like
-- stampies-corner-cafe, which are shorter. Owner ids stay 22 to 80.
-- Apply after 001 to 004. Fresh deploys already get the relaxed rule
-- from the updated 001 and 002, so this file is a no-op for them.
BEGIN;
ALTER TABLE stampies_wallet.issue_grants DROP CONSTRAINT IF EXISTS issue_grants_serial_check;
ALTER TABLE stampies_wallet.issue_grants ADD CONSTRAINT issue_grants_serial_check CHECK (serial ~ '^[A-Za-z0-9_-]{8,80}$');
ALTER TABLE stampies_wallet.apple_pass DROP CONSTRAINT IF EXISTS apple_pass_serial_check;
ALTER TABLE stampies_wallet.apple_pass ADD CONSTRAINT apple_pass_serial_check CHECK (serial ~ '^[A-Za-z0-9_-]{8,80}$');
COMMIT;
