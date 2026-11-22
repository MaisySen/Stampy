# Merchant identity and stamp permissions

This is a **server-side merchant identity foundation**, not a finished sign-up
or release-ready end-to-end stamp flow. It is intentionally separate from the
customer's no-login Wallet experience. No demo merchant or staff identity is
automatically provisioned.

## Source of authority

- A configured OIDC identity provider handles merchant and staff sign-in
  and issues an RS256 access token with Stampies API audience. The server
  verifies its signature against a pinned, HTTPS issuer JWKS plus issuer,
  audience, expiry, not-before and maximum token age. Decoding a JWT is not
  authentication.
- Postgres is authoritative for the merchant status, business ID, membership
  status and role. Each stamp causes a fresh membership lookup so suspended,
  revoked and viewer accounts cannot issue stamps even with a valid token.
- Stamps may be issued by active owners, admins, managers and staff only for
  the matching merchant. Unknown/inactive merchants, other businesses,
  missing credentials, provider errors and DB errors fail closed.
- A staff PIN, public QR code, pass ID or client-provided role is not evidence
  of merchant authority. The backend must also enforce stamping eligibility,
  configurable program rules, redemption and transaction audit history.

## Database setup

1. Apply server/auth/postgres/001-merchant-identities.sql as a privileged
   migration using Postgres 15 or later.
2. Apply server/auth/postgres/provision-auth-reader.sql. It creates a
   NOLOGIN role with schema usage and narrow column SELECT privileges only.
   The operator must configure safe login credentials separately using
   the hosting platform's secret manager, or inherit this role from a distinct
   restricted service principal.
3. Create a separate read-only connection pool for the merchant auth
   reader. Do not reuse the Wallet ledger connection for identity queries.
4. An authenticated, privileged onboarding/organisation service must insert
   the real merchant and grant an active owner membership only after
   verifying ownership and consent. Do not write sample rows or auto-enrol
   an authenticated caller as an owner.
5. When staff is terminated, update membership status to revoked or
   suspended; do not rely only on JWT expiration.

Identity records are scoped by the exact (issuer, subject) of the verified
provider token, plus a membership on the matched merchant. Database business
IDs must exactly match Wallet ledger businessId values.

## Service composition

After PR #3 adds the required authorizeStamp hook to the Wallet service,
the trusted backend can compose these already implemented modules:

~~~js
import {createOidcAccessTokenVerifier} from './server/auth/oidc-jwt.mjs';
import {createMerchantStampAuthorizer} from './server/auth/merchant-stamp-authorizer.mjs';
import {createPostgresMerchantMembershipStore} from './server/auth/postgres/membership-store.mjs';
import {openPostgresWalletService} from './server/wallet/postgres/service.mjs';

// All settings and pool credentials come from the deployer's private config.
const verifyAccessToken = createOidcAccessTokenVerifier({
  issuer: authIssuer,
  audience: apiAudience,
  jwksUri: trustedJwksUri,
});
const {lookupMembership} = createPostgresMerchantMembershipStore({
  pool: restrictedMerchantIdentityPool,
});
const authorizeStamp = createMerchantStampAuthorizer({
  verifyAccessToken,
  lookupMembership,
});
const wallet = await openPostgresWalletService({
  pool: restrictedWalletPool,
  authorizeStamp,
  origin: trustedWalletOrigin,
  lookupOwnedPass: committedMerchantLookup,
  apple: configuredAppleWalletService,
});
~~~

The values above are deployment adapters and configuration supplied by a
trusted host, not exported sample users, a new server entrypoint, or a
complete runnable application. Never use a verifier that only decodes claims,
an authorization callback that always returns true, or a merchant-owned secret
in the Expo bundle.

The current Expo app's stamp sender still lacks a real merchant session and
passes only client-generated identifiers. That sender must not be granted
server stamp permissions merely to make the screen look functional. Build
merchant/staff login, secure server session handling, and an authorised staff
counter flow first. Customer Wallet issuance and redemption have separate
permission and anti-fraud requirements.

## Test evidence and release gates

Run: node --test tests/merchant-auth.test.mjs

The independent GitHub Action Stampies Merchant Auth runs it on PRs that
change authentication code. Tests exercise JWT verification,
forged/expired/rotated tokens, identity store parameterisation, active
and revoked roles, and cross-merchant attempts.

These tests are local fixtures. Before any production deployment additionally:
- Verify real OIDC issuer and audience configuration, JWKS rotation and expiry.
- Apply the migrations on disposable Postgres and verify read-only role grants.
- Wire the auth module into PR #3's fail-closed stamp service on a staging host.
- Require actual merchant sign-in and an authenticated staff action on device.
- Verify server-enforced cooldown, daily limits, location scopes, program
  rules, redemption, revocation, concurrency, auditing and rate limits.
- Verify a real signed Wallet pass refreshes after an authorised transaction.
- Complete billing, onboarding, multi-location, campaign delivery, analytics,
  operational support and admin features before claiming full product.

**Status: identity-verification and authorisation foundation implemented;
not integrated with production login, merchant onboarding or live Wallet.**
