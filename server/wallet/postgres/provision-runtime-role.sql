-- Provisioning template. No secret or live LOGIN is included.
-- Apply as the separately authorised schema owner, on the selected Wallet database only.
BEGIN;
CREATE ROLE stampies_wallet_runtime NOLOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA stampies_wallet TO stampies_wallet_runtime;
GRANT SELECT,INSERT,DELETE ON stampies_wallet.issue_grants TO stampies_wallet_runtime;
GRANT SELECT,UPDATE(revision) ON stampies_wallet.apple_clock TO stampies_wallet_runtime;
GRANT SELECT,INSERT,UPDATE(payload,source_version,revision) ON stampies_wallet.apple_pass TO stampies_wallet_runtime;
GRANT SELECT,INSERT,UPDATE(encrypted_push),DELETE ON stampies_wallet.apple_registration TO stampies_wallet_runtime;
GRANT SELECT,INSERT,UPDATE(revision,ready_at,lease_id,lease_until,failures),DELETE ON stampies_wallet.apple_wake TO stampies_wallet_runtime;
GRANT SELECT,INSERT ON stampies_wallet.stamp_ledger TO stampies_wallet_runtime;
COMMIT;
