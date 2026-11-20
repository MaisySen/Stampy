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

Product:

1. Define the reward rule.
2. Define the stamp methods.
3. Define the nearby nudge copy and limits.
4. Define the birthday reward.
5. Define the win-back rule.

Wallet:

6. Design the Apple Wallet pass.
7. Design the Google Wallet pass.
8. Build the pass install flow.
9. Update the pass on each stamp.
10. Handle pass expiry and reward state.

Stamp:

11. Build the NFC tap flow.
12. Build the QR scan flow.
13. Build the staff stamp with PIN.
14. Add fraud controls: cooldown, daily limit, device check.
15. Add an offline stamp queue.

Analytics:

16. Show stamps given total.
17. Show visitors and repeat rate.
18. Show stamps over time chart.
19. Show the split by NFC, QR, and staff.
20. Show the lapsed customer list.

Design:

21. Lock the Orbix theme tokens.
22. Build the Wallet screen.
23. Build the Analytics screen.
24. Build the stamp flow screens.
25. Build empty states and error states.

Release:

26. Typecheck and tests green.
27. Ship a TestFlight internal build.
28. Ship a Play internal track build.
29. Publish store listings and privacy pages.

## Decisions

See docs/DECISIONS.md. Five open decisions with recommendations, and a log of what was decided.
