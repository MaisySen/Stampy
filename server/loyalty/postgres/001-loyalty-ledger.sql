-- Real merchant-scoped loyalty ledger. Requires PR #5 merchant identity migration.
-- Apply once with a privileged migration role, NEVER from the mobile client.
-- No seed businesses, customers, balances or demo transactions are created.
CREATE SCHEMA IF NOT EXISTS stampies_loyalty;

CREATE TABLE stampies_loyalty.locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES stampies_identity.merchants(id),
  code VARCHAR(60) NOT NULL CHECK (code ~ '^[A-Za-z0-9_-]{1,60}$'),
  name VARCHAR(160) NOT NULL CHECK (length(trim(name)) > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, id),
  UNIQUE (merchant_id, code)
);

CREATE TABLE stampies_loyalty.programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES stampies_identity.merchants(id),
  public_code VARCHAR(64) NOT NULL UNIQUE,
  reward_text VARCHAR(200) NOT NULL CHECK (length(trim(reward_text)) > 0),
  target INTEGER NOT NULL CHECK (target BETWEEN 1 AND 100),
  daily_limit INTEGER NOT NULL DEFAULT 1 CHECK (daily_limit BETWEEN 1 AND 20),
  cooldown_seconds INTEGER NOT NULL DEFAULT 60 CHECK (cooldown_seconds BETWEEN 0 AND 86400),
  time_zone VARCHAR(100) NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'paused', 'retired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, id)
);

-- One-time, short-lived enrolment capabilities; customers need no login.
-- Store only the SHA-256 digest, never a raw enrolment secret.
CREATE TABLE stampies_loyalty.enrollment_grants (
  digest CHAR(64) PRIMARY KEY CHECK (digest ~ '^[a-f0-9]{64}$'),
  merchant_id UUID NOT NULL,
  program_id UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (merchant_id, program_id) REFERENCES stampies_loyalty.programs(merchant_id, id)
);

CREATE INDEX enrollment_grants_expiry ON stampies_loyalty.enrollment_grants(expires_at);

CREATE TABLE stampies_loyalty.memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL,
  program_id UUID NOT NULL,
  pass_id VARCHAR(80) NOT NULL UNIQUE CHECK (pass_id ~ '^stp_[a-f0-9]{32}$'),
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance BETWEEN 0 AND 100),
  lifetime_stamps INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_stamps >= 0),
  rewards_redeemed INTEGER NOT NULL DEFAULT 0 CHECK (rewards_redeemed >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (merchant_id, program_id) REFERENCES stampies_loyalty.programs(merchant_id, id),
  UNIQUE (merchant_id, id)
);

CREATE INDEX memberships_merchant_program ON stampies_loyalty.memberships(merchant_id, program_id);

CREATE TABLE stampies_loyalty.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL,
  membership_id UUID NOT NULL,
  location_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('stamp', 'redeem')),
  request_key VARCHAR(100) NOT NULL CHECK (length(request_key) BETWEEN 16 AND 100),
  request_digest VARCHAR(64) NOT NULL CHECK (request_digest ~ '^[a-f0-9]{64}$'),
  previous_balance INTEGER NOT NULL CHECK (previous_balance BETWEEN 0 AND 100),
  next_balance INTEGER NOT NULL CHECK (next_balance BETWEEN 0 AND 100),
  local_day DATE NOT NULL,
  actor_issuer VARCHAR(512) NOT NULL,
  actor_subject VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (merchant_id, membership_id) REFERENCES stampies_loyalty.memberships(merchant_id, id),
  FOREIGN KEY (merchant_id, location_id) REFERENCES stampies_loyalty.locations(merchant_id, id),
  UNIQUE (membership_id, request_key)
);

CREATE INDEX loyalty_events_day ON stampies_loyalty.events(membership_id, event_type, local_day);
CREATE INDEX loyalty_events_recent ON stampies_loyalty.events(membership_id, created_at DESC);

-- No privilege for public clients, anonymous visitors or the Wallet signer.
REVOKE ALL ON SCHEMA stampies_loyalty FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA stampies_loyalty FROM PUBLIC;
