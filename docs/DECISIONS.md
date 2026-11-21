# Stampies decisions

Five decisions. All five are decided. Nothing here is decided until it is logged at the bottom.

## D1. First vertical

Question: which businesses do we start with?

Decision: all business types from the start. The product works for any repeat-visit business, not only cafes and bakeries. Cafes and bakeries stay the first outreach because they have daily repeat visits and owners at the counter, but the product is not limited to them.

Status: Decided 2026-11-21, in Bidur's words: why can't it be for all business?

## D2. Reward rule

Question: what does a full card earn?

Decision: no fixed rule. Buy count and reward are adjustable per business, because it depends on the business. Each business sets its own buy count and reward in the pass builder. The default suggestion stays buy 8, get the 9th free.

Status: Decided 2026-11-21, in Bidur's words: buy and rewards must be adjustable because it depends on the business.

## D3. Stamp methods at launch

Question: which stamp methods ship in the MVP?

Decision: all methods. QR code and staff stamp in the MVP. NFC tap also at launch where the terminal supports it. Automatic stamp when a customer pays on EFTPOS comes as a follow-on integration through the payment provider, subject to feasibility.

Status: Decided 2026-11-21. NFC tap needs a verified compatible terminal. EFTPOS automatic stamping needs a payment provider integration and is not a generic terminal hook.

## D4. Pricing

Question: what does a business pay?

Decision: A$39 ex GST per location per month, one flat plan, everything included, free trial for one month, no charge per stamp. Extra locations A$25 to A$30 ex GST each. Annual billing minus 20 percent.

Status: Decided 2026-11-21. Bidur chose A$39 after the competitor pricing research.

## D5. Platform

Question: Expo or native?

Recommendation: Expo with TypeScript, one codebase for iOS and Android, EAS Build and EAS Update. This matches the runbook Expo OTA path. Native only if a Wallet or NFC feature proves impossible in Expo, and no such case has been found yet.

Status: Decided. Expo with TypeScript. Decided 2026-11-20, at the start of this repo.

## Decisions log

| Date | Decision | What was decided | Why |
| --- | --- | --- | --- |
| 2026-11-20 | D5 Platform | Expo with TypeScript, EAS Build and Update | One codebase for iOS and Android, matches the runbook OTA path |
| 2026-11-21 | D2 Reward rule | No fixed rule. Each business sets its own buy count and reward in the pass builder, default suggestion buy 8, get the 9th free | Buy and rewards depend on the business |
| 2026-11-21 | D1 First vertical | All business types from the start, cafes and bakeries first for outreach | The product works for any repeat-visit business |
| 2026-11-21 | D3 Stamp methods | All methods: QR code and staff stamp in the MVP, NFC tap at launch where the terminal supports it, EFTPOS automatic stamp as a follow-on payment provider integration | Bidur asked for all methods including automatic stamping on payment |
| 2026-11-21 | D4 Pricing structure | Monthly per location, one paid tier, free trial for one month, no charge per stamp. Amount open | Bidur set the structure; amount pending competitor pricing research |
| 2026-11-21 | D4 Pricing amount | A$39 ex GST per location per month, one flat plan, extra locations A$25 to A$30, annual minus 20 percent | Bidur chose A$39 after the competitor pricing research; typical Australian entry price is A$49 |

## Phase note, 2026-11-20

No new decisions in this phase. D1 to D4 remain open. The build uses the existing recommendations: buy 8, get the 9th free; QR and staff stamping in the MVP, NFC in V2; monthly per location with a free trial. Fraud controls use a 4 digit staff PIN, a 60 second cooldown, and one stamp per day. Win-back uses 30 days quiet. These are the recommendations as written, not new decisions.
