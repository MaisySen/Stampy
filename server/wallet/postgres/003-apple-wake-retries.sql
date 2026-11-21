BEGIN;
ALTER TABLE stampies_wallet.apple_wake
  ADD COLUMN IF NOT EXISTS failures SMALLINT NOT NULL DEFAULT 0 CHECK (failures BETWEEN 0 AND 8);
CREATE INDEX IF NOT EXISTS apple_wake_dispatch_due ON stampies_wallet.apple_wake(ready_at,revision,device,serial)
  WHERE failures<8;
COMMIT;
