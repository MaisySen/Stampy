# Stampy plan

Condensed from the Stampy Full Plan space. Short plain sentences. No filler.

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

Birthday treat: if the customer shares a birthday when they join, Stampy sends a reward automatically.

Readable analytics: stamps given, customers who visited, stamps over time, split by NFC tap, QR code, and staff. No 40 chart dashboard.

## Pass builder

A business builds its own pass in the app, in four steps.

1. Details: business name, reward text, stamp target with 9 as the default.
2. Design: brand colour, cover style, optional business photo URL.
3. Links: menu link, Wi-Fi name and password, feedback link, one external link with a label. All optional, all clearable.
4. Preview and publish: a live phone preview titled Building your pass. The photo is front and centre. The stamp count shows big as 0/9. A QR code adds the pass to Wallet. The pass is marked Powered by Stampy.

Publish shows the share link and QR code. The customer needs no app download. Every pass keeps the Stampy differentiators: Wallet pass, NFC tap, QR code and staff stamp, nearby nudge, birthday reward, and business analytics.

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
11. Pass builder, Details and Design. Business name, reward text, stamp target, brand colour, cover style, photo URL.
12. Pass builder, Links. Menu, Wi-Fi, feedback, and one external link.
13. Pass builder, Preview and publish. Live phone preview, big 0/9 stamp count, QR code, Powered by Stampy, publish and share.

## Roadmap

MVP: Wallet pass creation, QR and staff stamping, reward redemption, basic analytics, birthday reward, business dashboard. Done when a cafe can sign up, issue a card, stamp a customer, and see the stamp in analytics the same day.

V2: NFC tap to stamp, nearby notifications, win-back campaigns for lapsed customers, multi-location support, referral. Done when a lapsed customer gets a win-back nudge and returns, and a second location can run its own program.

Later: POS integrations, tiered rewards, gift cards, customer segments.

## Tech

Expo with TypeScript, React Native, one codebase for iOS and Android. EAS Build and EAS Update, preview channel first, then production. Runtime version 1.0.0. iOS bundle ID au.fintex.stampy. Android package au.fintex.stampy. Version 1.0.0.

Wallet passes: Apple Wallet PassKit and Google Wallet API, on the server. Pass updates on each stamp. NFC tap uses a counter tag. QR codes are per business, rotated. Staff stamps need a PIN. Fraud controls: cooldown between stamps, one stamp per customer per day per business, and a daily limit.

No login and no ads for now. No hard coded popular content. Lists are user made and clearable.

## Pricing

Monthly per location, one paid tier to start, free trial. No charge per stamp. Businesses hate unpredictable bills. Confirm the amount in docs/DECISIONS.md.

## Go to market, first 10 Sydney businesses

Start with 10 cafes and bakeries in Sydney. Visit in person. Set up each program in 10 minutes at the counter. Give each business a printed QR card and a tap point. Measure: cards added, stamps per day, repeat visits in 14 days. Use the first 10 to fix onboarding before wider launch.

## Risks

Fraud: staff stamps and QR codes can be gamed. Answer: cooldowns, staff PINs, one stamp per day.

Notification fatigue: nearby nudges must be rare and useful, or customers delete the card. Answer: one nudge per day max, only with a real offer.

Cold start: businesses are needed before customers care. Answer: start narrow with cafes, bakeries, and barbers.

Apple and Google pass rules: passes can be rejected or limited. Answer: follow the pass guidelines, keep the card simple, test on real devices.

Churn: small businesses stop paying if they see no return. Answer: show stamps and repeat visits in the first week.

## Build checklist

Status at 2026-11-20, local phase, not pushed yet. 23 of 34 done, 3 partial, 8 open. A partial item has its UI flow done and its server or hardware part still open.

Product:

- [x] 1. Define the reward rule.
- [x] 2. Define the stamp methods.
- [x] 3. Define the nearby nudge copy and limits.
- [x] 4. Define the birthday reward.
- [x] 5. Define the win-back rule.

Wallet:

- [ ] 6. Design the Apple Wallet pass.
- [ ] 7. Design the Google Wallet pass.
- [ ] 8. Build the pass install flow.
- [ ] 9. Update the pass on each stamp.
- [ ] 10. Handle pass expiry and reward state.

Stamp:

- [~] 11. Build the NFC tap flow. UI flow done, real hardware tap ships in V2.
- [x] 12. Build the QR scan flow.
- [x] 13. Build the staff stamp with PIN.
- [~] 14. Add fraud controls: cooldown, daily limit, device check. Cooldown, daily limit, and staff PIN are wired into the stamp flow. Device check is still open.
- [ ] 15. Add an offline stamp queue.

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
- [x] 33. Keep the Powered by Stampy mark on every pass.
- [x] 34. Check the builder on phone width: spacing, alignment, touch targets.

## Decisions

See docs/DECISIONS.md. Five open decisions with recommendations, and a log of what was decided.
