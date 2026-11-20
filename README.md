# Stampies

Paper stamp cards, rebuilt for Apple and Google Wallet.

Stampies is a digital loyalty app for small businesses. Customers add a business card to their Wallet once. They earn stamps by NFC tap, QR code, or staff stamp. When the card is full, they get the reward. No app download. No card to lose. No login.

## Who it is for

Start narrow: cafes, bakeries, and barbers in Sydney. These businesses want repeat customers, and their customers already carry a phone all day.

## How it works

Customer side:

1. Add the business card to Apple Wallet or Google Wallet.
2. Earn a stamp at the counter by tap, scan, or staff stamp.
3. Watch progress on the card. At 8 stamps, the 9th visit earns the reward.
4. Redeem the reward at the counter.

Business side:

1. Set the reward rule and card design in the dashboard.
2. Give stamps from the counter with NFC, QR, or staff stamp.
3. See stamps given, customers who visited, and stamps over time.
4. Send a nearby nudge when a customer is close, and a birthday treat on their birthday.

## Pass builder

A business builds its own pass in four steps: Details, Design, Links, Preview. Details are the business name, reward text, and stamp target, with 9 as the default. Design is the brand colour, cover style, and an optional business photo. Links are the menu, Wi-Fi, feedback, and one external link. All fields are business made, optional where marked, and clearable. The Preview step shows a live phone preview titled Building your pass, with the photo front and centre, the stamp count big as 0/9, and a QR code to add the pass to Wallet. Publish shows the share link and QR code. The customer needs no app download to add the pass. Every pass is marked Powered by Stampies.

## Fraud controls

Staff stamps need the 4 digit staff code, set in Program settings. A stamp is blocked during the 60 second cooldown, and after one stamp per day. The stamp screen shows the reason when a stamp is blocked, and a Check again button. No login is needed.

## Birthday and win-back

The Wallet screen shows a birthday reward card when the birthday is this month, and a ready state on the day itself. Analytics shows a win-back list for customers quiet for 30 days or more, with a Send nudge button per customer, and a birthdays this month list. Lists use local demo customers, and the business can clear them from Analytics.

## Legal pages

Privacy, terms, and support pages live in `docs/PRIVACY.md`, `docs/TERMS.md`, and `docs/SUPPORT.md`, and in the app under Program, About Stampies. Each names Fintex Australia Pty Ltd (ABN 60 688 406 108), contact contact@fintex.au, and website https://fintex.au. No login is needed, and no ads are shown.

## What is in this repo

- `App.tsx` and `src/`: the Expo app. Customer Wallet card, stamp flow, business Analytics, program settings, and the pass builder.
- `src/components/PassPreview.tsx`: the live phone preview for a pass, with the photo, stamp count, QR code, and Powered by Stampies mark.
- `src/screens/LegalScreen.tsx`: in-app privacy, terms, and support pages, opened from Program.
- `docs/PRIVACY.md`, `docs/TERMS.md`, `docs/SUPPORT.md`: the store readiness pages.
- `src/lib/fraud.ts`, `src/lib/loyalty.ts`, `src/lib/analytics.ts`, `src/lib/stamps.ts`: pure logic, covered by tests in `tests/`.
- `docs/PLAN.md`: the full plan, condensed.
- `docs/DECISIONS.md`: the 5 open decisions and their recommendations.
- `docs/RELEASES.md`: build records. `CHANGELOG.md`: what changed per version.
- `app.json`, `eas.json`: Expo config and channels.

## Design

Orbix style. Dark near-black background. Soft lavender-pink-peach gradient hero card. Huge numerals. Rounded 24 to 28px cards. Stacked cards. Gradient charts. Floating white pill bottom nav with a lavender active tab. Generous spacing. Muted grey secondary text. Soft shadows. Every control has a clear pressed and selected state.

## Setup

Requirements: Node 20 or later, npm, the Expo Go app on a phone for testing, and an EAS account for builds.

Install:

```sh
npm install
```

Generate the brand assets (icon and splash art):

```sh
python3 scripts/make-assets.py
```

Run in development:

```sh
npm start
```

Then scan the QR code with Expo Go, or press `i` for iOS Simulator, `a` for Android Emulator.

Typecheck:

```sh
npm run typecheck
```

## Configuration

Copy `.env.example` to `.env` and fill in values for your environment. Never commit `.env`. Values come from an ignored `.env` file or CI secrets at build time. Placeholders only in source. Replace the zero project ID in `app.json` and `eas.json` with the real EAS project ID when the EAS project is created.

## MVP scope

MVP is: Wallet pass creation, the pass builder, QR and staff stamping, reward redemption, basic analytics, birthday reward, and the business dashboard. NFC tap, nearby nudges, win-back campaigns, and multi-location support come in V2. See `docs/PLAN.md`.

## Privacy

The Wallet card only knows where the business is. The phone works out when the customer is nearby, on the device. Stampies does not track a customer live. There is no login and no ads for now.

## Legal

Stampies is provided by Fintex Australia Pty Ltd (ABN 60 688 406 108), New South Wales, Australia. Contact: contact@fintex.au. Website: https://fintex.au
