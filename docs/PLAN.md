# Stampies plan

Condensed from the Stampies Full Plan space. Short plain sentences. No filler.

## Concept

Paper stamp cards, rebuilt for Apple and Google Wallet. A customer adds a business card to Wallet once. Stamps come from NFC tap, QR code, or staff stamp. A full card earns a reward. Businesses see who comes back, and who has gone quiet.

## Problem

Paper cards get lost. Businesses learn nothing from them. Apps that customers must download get deleted. Wallet is already on the phone, so the friction is near zero.

## Users

Customers: cafe, bakery, and barber customers in Sydney. They want a free coffee or cut, with no new app and no login.

Businesses: small cafes, bakeries, and barbers. They want repeat visits, and a simple way to reward them.

## Core loop

1. Customer adds the card to Wallet.
2. Customer earns a stamp in about 2 seconds at the counter.
3. Customer sees progress on the card.
4. Customer redeems the reward.
5. Business sees the visit in analytics.

## Magic moments

Nearby nudge: the Wallet card only knows where the business is. The phone works out when the customer is close, on the device, and shows a lock screen nudge. No live tracking.

Birthday treat: if the customer shares a birthday when they join, Stampies sends a reward automatically.

Readable analytics: stamps given, customers who visited, stamps over time, split by NFC tap, QR code, and staff. No 40 chart dashboard.

## Pass builder

A business builds its own pass in the app, in four steps.

1. Details: business name, reward text, paid visits with 8 as the default (3 to 11 allowed), then the next visit is free.
2. Design: brand colour, cover style, optional business photo URL.
3. Links: menu link, Wi-Fi name and password, feedback link, one external link with a label. All optional, all clearable.
4. Preview and publish: a live phone preview titled Building your pass. The photo is front and centre. The paid visit count shows big as 0/8 by default. A placeholder QR code stands in until Wallet passes are live. The pass is marked Powered by Stampies.

In the local demo, Create local preview link shows a link that is not published. The customer needs no app download. Every pass keeps the Stampies differentiators: Wallet pass, NFC tap, QR code and staff stamp, nearby nudge, birthday reward, and business analytics.

## Local demo status

Verified on branch feat/stampies-local-demo-journey-20261122 (local, synthetic data):

- Program settings (name, reward, paid visits, default 8, range 3 to 11) save, reopen and drive the Wallet, Stamp, Program and preview screens.
- Stamp progress, eligibility and local redemption persist across restarts. Redeem works only when eligible.
- Invalid settings and storage failures show on screen. Unreadable saved progress is never overwritten.
- Stamps taken before the offline queue is ready are held in a saved outbox and handed to the queue by id. Retry and restart do not lose or duplicate stamps. Verified for the synthetic local tests only, and only while the progress record is saved; if both the progress write and the queue write fail, stamps live in this session only until Retry save works. Each stamp keeps a fixed program identity from when it was taken. Older stamps with no recorded program stay in the outbox, unqueued and unsynced, with a visible notice. Open: a decision on how to migrate them. No real queue sync, server or Wallet has been run.

Unfinished live functionality:

- Real publish of a program and a real pass link.
- Issuing Apple Wallet and Google Wallet passes, and pass updates on each stamp.
- Real QR scan and NFC tap stamping against a server.
- Server confirmed stamps and redemptions through the Wallet server.
- Postgres Wallet server tests, which need the `pg` package and a Postgres fixture.
- Device testing, EAS builds and store release.

## Screens

1. Customer Wallet card. Stamp grid, progress to reward, barcode, nearby nudge, birthday card.
2. Stamp flow, NFC tap. Big tap target, success state, stamp count update.
3. Stamp flow, QR code. Scannable code card for the counter.
4. Stamp flow, staff. Staff adds a stamp with a PIN confirm.
5. Reward redeem. Reward state, redeem confirm, used state.
6. Business Analytics. Stamps given, visitors, stamps over time chart, split by method.
7. Business Customers. Customer list, visits, last visit, lapsed flag.
8. Business Campaigns. Nearby nudge, birthday treat, win-back message.
9. Business Program setup. Reward rule, card design, stamp methods, toggles.
10. Business Settings. Business details, legal line, data clear, version.
11. Pass builder, Details and Design. Business name, reward text, paid visits, brand colour, cover style, photo URL.
12. Pass builder, Links. Menu, Wi-Fi, feedback, and one external link.
13. Pass builder, Preview and publish. Live phone preview, big 0/8 paid visit count by default, placeholder QR code, Powered by Stampies, local preview link (not published).

## Roadmap

MVP: Wallet pass creation, QR and staff stamping, reward redemption, basic analytics, birthday reward, business dashboard. Done when a cafe can sign up, issue a card, stamp a customer, and see the stamp in analytics the same day.

V2: NFC tap to stamp, nearby notifications, win-back campaigns for lapsed customers, multi-location support, referral. Done when a lapsed customer gets a win-back nudge and returns, and a second location can run its own program.

Later: POS integrations, tiered rewards, gift cards, customer segments.

## Tech

Expo with TypeScript, React Native, one codebase for iOS and Android. EAS Build and EAS Update, preview channel first, then production. Runtime version 1.0.0. iOS bundle ID au.fintex.stampies. Android package au.fintex.stampies. Version 1.0.0.

Wallet passes: Apple Wallet PassKit and Google Wallet API, on the server. Pass updates on each stamp. NFC tap uses a counter tag. QR codes are per business, rotated. Staff stamps need a PIN. Fraud controls: cooldown between stamps, one stamp per customer per day per business, and a daily limit.

No login and no ads for now. No hard coded popular content. Lists are user made and clearable.

## Store

App Store record is done. Name Stampies. Language English (Australia). Bundle ID au.fintex.stampies. SKU stampies-ios-1. Platform iOS. Full Access. Apple ID 6837253268, in eas.json on main. The Admin App Store Connect API key is confirmed, 2026-11-21. The EAS project ID is 6b763cc2-7374-441c-bb17-04c5c4b7710c, in app.json and eas.json on main, with preview and production channels separate. The Google Play service account key is still needed for this Tab, but Google work is held for now. The Stampies CI workflow is on main, with the SQLite flag for the Wallet server tests.

## Pricing

A$39 ex GST per location per month, one flat plan, everything included. Free trial for one month. No charge per stamp. Extra locations A$25 to A$30 ex GST each. Annual billing minus 20 percent. Businesses hate unpredictable bills. Decided in docs/DECISIONS.md, 2026-11-21.

## Go to market, first 10 Sydney businesses

Start with 10 cafes and bakeries in Sydney. Visit in person. Set up each program in 10 minutes at the counter. Give each business a printed QR card and a tap point. Measure: cards added, stamps per day, repeat visits in 14 days. Use the first 10 to fix onboarding before wider launch.

## Risks

Fraud: staff stamps and QR codes can be gamed. Answer: cooldowns, staff PINs, one stamp per day.

Notification fatigue: nearby nudges must be rare and useful, or customers delete the card. Answer: one nudge per day max, only with a real offer.

Cold start: businesses are needed before customers care. Answer: start narrow with cafes, bakeries, and barbers.

Apple and Google pass rules: passes can be rejected or limited. Answer: follow the pass guidelines, keep the card simple, test on real devices.

Churn: small businesses stop paying if they see no return. Answer: show stamps and repeat visits in the first week.

## Next phase plan

Decided in advance. Nothing here comes back to Bidur as a question. The only asks from Bidur are the ones only he can do: tap the GitHub approval card when it appears, his accounts, his PC steps, and money.

1. Runtime-scope merge lands. In flight. It needs only the approval card tap.
2. One batched push, no decision needed: the Apple push worker, the Postgres push scheduler, dead wake cleanup, offline queue persistence, and the docs (decisions, Admin key note, worker and scheduler sections, release rows). The only ask is the approval card tap.
3. Wire App.tsx to the offline store at startup, and wire the runtime-role verifier into Wallet service startup. Both are small, already decided.
4. First EAS preview build. Needs the Expo token confirmed and the three EAS environments existing. That is the main Tab track. Verify from this side what can be verified, then build.
5. Live backend deploy, then the physical install and update test on a real pass. Main Tab track for the deploy, this side for the test.
6. Google work stays held. TestFlight follows the preview build. Play follows Google being unheld.

Decision rule for this project: when a review says yes, merge without asking. When a review says no, report what must change. Ask Bidur only when the choice needs his money, his accounts, or his PC.

Status at 2026-11-21. The repo is at 26 commits, head 997820e. 24 of 34 done, 5 partial, 5 open. A partial item has its UI flow done and its server or hardware part still open. Build 6 merged the Stampies CI workflow, commit 92c0dd5, with Apple ID 6837253268 in eas.json. The Node 22 SQLite flag for the Wallet server tests was added on github.com in commit ea9df79, so the CI workflow is complete on main. Build 7 merged server Wallet signing, commit 89eb1d1, with 4 Wallet server tests. Build 8 merged the Apple Wallet APNs update service, commit 5880257, with 7 Wallet server tests. D2 is decided: buy count and reward are adjustable per business, default suggestion buy 8, get the 9th free, implemented in commit 367cd53. Pass Type ID pass.au.fintex.stampies is registered and verified, 2026-11-21. 116 app tests pass 0 fail, 7 Wallet server tests pass 0 fail, typecheck exit 0, scan passed, config check exit 0, Android bundle 6.0M and iOS bundle 6.0M, both exit 0. The Postgres Wallet service and the durable wake queue are on main in commit b62770f. The EAS project link is on main in commit 9c64486. The restricted Wallet database role is on main in commit a193411. Build 13 is on main in commit 997820e: Apple push worker, Postgres push scheduler, dead wake cleanup, offline queue persistence. Built locally, not yet pushed: App.tsx wired to the offline queue store, runtime-role verifier wired into Wallet service startup, offline sync drain, stamp intake endpoint with migration 004, and the real stamp sender with walletOrigin config. Wallet items 6, 7 and 10 are still open. Item 8 is partial: the Add to Wallet screen is wired into App.tsx, and the real Wallet call is server work. Item 9 is partial: the stamp intake endpoint calls the pass update path on each recorded stamp, and the physical install and update test is still open. Item 15 is done: the offline queue, persistence, drain, endpoint, and sender are built and wired. Pass signing is server code only, device check is a flag only. Apple standard Wallet certificate is already issued. Still needed for a real pass: mount the certificate and key on the server, with the WWDR intermediate and trust root, plus server-owned icon artwork, a hosted backend, a Google issuer class, and a physical install and update test.

Product:

- [x] 1. Define the reward rule.
- [x] 2. Define the stamp methods.
- [x] 3. Define the nearby nudge copy and limits.
- [x] 4. Define the birthday reward.
- [x] 5. Define the win-back rule.

Wallet:

- [ ] 6. Design the Apple Wallet pass.
- [ ] 7. Design the Google Wallet pass.
- [~] 8. Build the pass install flow. Add to Wallet screen is wired into App.tsx from the Wallet screen. The real Wallet call is server work.
- [~] 9. Update the pass on each stamp. Stamp intake endpoint records each stamp and calls the pass update path, so the pass refresh queues on the server. Physical install and update test still open.
- [ ] 10. Handle pass expiry and reward state.

Stamp:

- [~] 11. Build the NFC tap flow. UI flow done, real hardware tap ships in V2.
- [x] 12. Build the QR scan flow.
- [x] 13. Build the staff stamp with PIN.
- [~] 14. Add fraud controls: cooldown, daily limit, device check. Cooldown, daily limit, and staff PIN are wired into the stamp flow. Device check is still open.
- [x] 15. Add an offline stamp queue. Queue, persistence store, sync drain, stamp intake endpoint, and real sender are built and wired into App.tsx. Live sync starts when walletOrigin is set to the live backend origin.

Analytics:

- [x] 16. Show stamps given total.
- [x] 17. Show visitors and repeat rate.
- [x] 18. Show stamps over time chart.
- [x] 19. Show the split by NFC, QR, and staff.
- [x] 20. Show the lapsed customer list.

Design:

- [x] 21. Lock the Orbix theme tokens.
- [x] 22. Build the Wallet screen.
- [x] 23. Build the Analytics screen.
- [x] 24. Build the stamp flow screens.
- [x] 25. Build empty states and error states.

Release:

- [x] 26. Typecheck and tests green.
- [ ] 27. Ship a TestFlight internal build.
- [ ] 28. Ship a Play internal track build.
- [~] 29. Publish store listings and privacy pages. Privacy, terms, and support pages are written in docs and in the app. Store listings still need the App Store record and the Play Console steps.

Pass builder:

- [x] 30. Build the four step builder: Details, Design, Links, Preview.
- [x] 31. Build the live phone preview with photo, big 0/9 count, and QR code.
- [x] 32. Add the publish step with share link and QR code.
- [x] 33. Keep the Powered by Stampies mark on every pass.
- [x] 34. Check the builder on phone width: spacing, alignment, touch targets.

## Decisions

See docs/DECISIONS.md. All five decisions are decided: D1 all business types, D2 per-business adjustable rewards, D3 all stamp methods, D4 A$39 per location per month, D5 Expo with TypeScript.
