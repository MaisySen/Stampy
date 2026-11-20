# Stampy decisions

Five open decisions. Each has a recommendation. Nothing here is decided until it is logged at the bottom.

## D1. First vertical

Question: which businesses do we start with?

Recommendation: cafes and bakeries in Sydney. They have daily repeat visits, simple rewards, and owners at the counter. Barbers join after the first 10.

Status: Open.

## D2. Reward rule

Question: what does a full card earn?

Recommendation: buy 8, get the 9th free. One rule, easy to explain at the counter, easy to show on the card.

Status: Open.

## D3. Stamp methods at launch

Question: which stamp methods ship in the MVP?

Recommendation: QR code and staff stamp in the MVP. NFC tap in V2. QR and staff need no hardware, so a business can start in 10 minutes. NFC adds cost and setup time.

Status: Open.

## D4. Pricing

Question: what does a business pay?

Recommendation: monthly per location, one paid tier to start, free trial, no charge per stamp. Confirm the amount before launch. Businesses hate unpredictable bills.

Status: Open.

## D5. Platform

Question: Expo or native?

Recommendation: Expo with TypeScript, one codebase for iOS and Android, EAS Build and EAS Update. This matches the runbook Expo OTA path. Native only if a Wallet or NFC feature proves impossible in Expo, and no such case has been found yet.

Status: Decided. Expo with TypeScript. Decided 2026-11-20, at the start of this repo.

## Decisions log

| Date | Decision | What was decided | Why |
| --- | --- | --- | --- |
| 2026-11-20 | D5 Platform | Expo with TypeScript, EAS Build and Update | One codebase for iOS and Android, matches the runbook OTA path |

## Phase note, 2026-11-20

No new decisions in this phase. D1 to D4 remain open. The build uses the existing recommendations: buy 8, get the 9th free; QR and staff stamping in the MVP, NFC in V2; monthly per location with a free trial. Fraud controls use a 4 digit staff PIN, a 60 second cooldown, and one stamp per day. Win-back uses 30 days quiet. These are the recommendations as written, not new decisions.
