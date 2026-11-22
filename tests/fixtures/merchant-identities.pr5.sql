-- Merchant identity foundation for production-authorised stamp issuance.
-- Apply through a privileged migration connection, never in the Expo app.
-- There are deliberately NO demo businesses or pre-authorised staff.
CREATE SCHEMA IF NOT EXISTS stampies_identity;

CREATE TABLE IF NOT EXISTS stampies_identity.merchants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id VARCHAR(60) NOT NULL UNIQUE
    CHECK (business_id ~ '^[A-Za-z0-9_-]{1,60}$'),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stampies_identity.merchant_memberships (
  merchant_id UUID NOT NULL REFERENCES stampies_identity.merchants(id) ON DELETE CASCADE,
  issuer VARCHAR(512) NOT NULL CHECK (length(issuer) BETWEEN 8 AND 512),
  subject VARCHAR(255) NOT NULL CHECK (length(subject) BETWEEN 1 AND 255),
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'manager', 'staff', 'viewer')),
  status TEXT NOT NULL DEFAULT 'invited'
    CHECK (status IN ('invited', 'active', 'suspended', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (merchant_id, issuer, subject)
);

CREATE INDEX IF NOT EXISTS merchant_memberships_identity
  ON stampies_identity.merchant_memberships (issuer, subject)
  WHERE status = 'active';

-- Explicit privileges are provisioned separately. The runtime Wallet DB
-- role must NOT inherit control of these merchant identity tables.
REVOKE ALL ON SCHEMA stampies_identity FROM PUBLIC;
REVOKE ALL ON TABLE stampies_identity.merchants FROM PUBLIC;
REVOKE ALL ON TABLE stampies_identity.merchant_memberships FROM PUBLIC;
