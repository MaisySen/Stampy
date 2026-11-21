# Stampies Wallet pass design

Publisher: Fintex Australia Pty Ltd.
This doc describes the pass data only. It does not sign a pass.
Signing needs a server. The server holds the Apple and Google keys.
No key lives in this repo. No login is needed to add a pass. No ads are shown.

## The pass in one line

One pass per business. The customer adds it once. Stamps update on the pass after each visit. The reward shows on the pass when the card is full.

## Apple Wallet pass

Pass type: store card. A store card is the Apple type for a loyalty card.
Pass type identifier: pass.au.fintex.stampies. Registered and verified, 2026-11-21.
Organization name: Fintex Australia Pty Ltd.
Team identifier: set by the server at signing time. It is a placeholder in local code.
Serial number: the customer pass id. One serial per customer per business.
Description: the business name plus the words stamp card.
Logo text: the business name.
Foreground colour: white. The stamp count must stay readable.
Background colour: the business brand colour from the pass builder.
Label colour: white.

### Apple fields, field by field

Primary field: stamps. Label is STAMPS. Value is the count and the target, for example 5 of 9.
Primary field: stamp grid. Label is STAMP GRID. Value is one filled dot per stamp earned and one empty dot per stamp left, for example five filled dots and four empty dots for 5 of 9. The grid on the pass matches the dot row in the app.
Secondary field: reward. Label is REWARD. Value is the reward text, for example Buy 8, get the 9th free.
Auxiliary field: to go. Label is TO GO. Value is the stamps left, for example 4 stamps to go. When the card is full, the value is Reward ready.
Back field: status. Label is STATUS. Value is one of Collecting stamps, Reward ready, Reward claimed, Pass expired.
Back field: cover. Label is COVER. Value is the cover style name from the pass builder.
Back field: terms. Label is TERMS. Value is the pass terms: one stamp per visit, one visit per day, the reward is the free item shown on the card, and the pass cannot be used after its expiry date.
Back field: powered by. Label is POWERED BY. Value is Powered by Stampies.
Back field: privacy. Label is PRIVACY. Value says the pass only knows where the business is, and the phone works out when the customer is nearby, on the device.
Back field: publisher. Label is PUBLISHER. Value is Fintex Australia Pty Ltd.

### Apple barcode

Format: QR code. Message: the customer pass id. Encoding: iso-8859-1.
Staff scan the code at the counter when NFC tap is not used.
The code is the same value as the serial number.

### Apple stamp grid

The pass shows the stamp count as big numerals, for example 5 of 9.
The app shows the same count as a row of dots. Filled dots are stamps earned. Empty dots are stamps left.
The dot count always matches the stamp target. The target is 4 to 12, with 9 as the default.

### Apple reward state

The four states come from one state machine in src/lib/pass.ts. The app, the pass payloads, and the server stamp intake all use it, so they always agree on the state.
Active: stamps are below the target. The pass shows the count and the stamps left.
Reward earned: stamps have reached the target. The pass shows Reward ready. The customer shows the pass at the counter.
Redeemed: the reward was claimed. The pass shows Reward claimed. A new card starts at 0 stamps.
Expired: today is past the expiry date. The pass is voided. The pass shows Pass expired.
A stamp is only allowed while the pass is active. A stamp on an expired pass is refused. A stamp on a redeemed pass is refused. A stamp on a full card is refused: the card must be redeemed before a new card starts.

### Apple expiry

Expiry is a plain date, for example 2027-06-30. No expiry date means the pass does not expire.
When an expiry date is set, it is stored as expirationDate on the pass.
The server stops stamping an expired pass.

### Apple nearby location

Location is optional. It needs latitude and longitude together.
Latitude is between -90 and 90. Longitude is between -180 and 180.
When set, the pass shows a lock screen note near the business, for example You are near Corner Cafe.
The phone works out the distance on the device. Stampies does not track the customer live.

## Google Wallet pass

Pass type: loyalty object. Class id: stampies-loyalty-class.
Object id: stampies, the business slug, and the customer pass id, joined with hyphens.
State: ACTIVE while collecting stamps. INACTIVE after the reward is claimed. EXPIRED after the expiry date.

### Google fields, field by field

Text module: Business. Body is the business name.
Loyalty points: label is Stamps. Balance is the count and the target, for example 5 of 9.
Text module: Reward. Body is the reward text.
Text module: To go. Body is the stamps left, or Reward ready when the card is full.
Text module: Status. Body is one of Collecting stamps, Reward ready, Reward claimed, Pass expired.
Text module: Stamp grid. Body is one filled dot per stamp earned and one empty dot per stamp left, the same grid as the Apple pass and the app.
Text module: Terms. Body is the pass terms, the same as the Apple back field.
Text module: Powered by. Body is Powered by Stampies.
Link module: one link to the pass page at stampies.app/p, plus the business slug. Description is Open your Stampies pass page.

### Google barcode

Type: QR_CODE. Value: the customer pass id.
Same value as the Apple barcode and the serial number. One code works for both wallets.

### Google stamp grid

Google shows the stamp count in the loyalty points balance, for example 5 of 9.
The app shows the same count as a row of dots, the same as Apple.

### Google reward state

The Google state follows the same state machine as Apple.
Active: stamps are below the target. State is ACTIVE.
Reward earned: stamps have reached the target. State stays ACTIVE. The To go module says Reward ready.
Redeemed: the reward was claimed. State is INACTIVE. A new card starts at 0 stamps.
Expired: today is past the expiry date. State is EXPIRED.
The same refusal rules apply: no stamp on an expired, redeemed, or full pass.

### Google expiry

Expiry is a plain date, for example 2027-06-30. No expiry date means the pass does not expire.
When an expiry date is set, it is stored as the end of the valid time interval.
The server stops stamping an expired pass.

### Google nearby location

Location is optional. It needs latitude and longitude together.
When set, Google Wallet can show the pass near the business.
The phone works out the distance on the device. Stampies does not track the customer live.

## Pass update on each stamp

Each stamp builds a fresh payload for Apple and for Google.
The new payload has the new stamp count, the new stamp grid, the new stamps left, and the new reward state.
The server sends the new payload to the phone. The phone does not need to open the app.
A full card flips to Reward ready on the next update.
A redeemed card starts a new card at 0 stamps.
An expired card stays expired.
The stamp intake endpoint returns the state after the stamp, and refuses a stamp on an expired, redeemed, or full pass. The Wallet screen shows the four states distinctly: collecting, reward ready, reward claimed, and pass expired.

## Colours

Brand colour comes from the pass builder. It is a hex colour like #C9B8FF.
The Apple pass uses the brand colour as the background.
Text on the pass is white, so the brand colour must stay dark enough to read.
The app uses the Orbix theme: dark near-black background, lavender, pink, and peach gradient hero, huge numerals, rounded cards.

## What is not in this round

Real PassKit signing. Real Google Wallet signing. The server that sends pass updates. NFC hardware. App Store and Play store work. Those are blocked by the server and store work. The payloads are final: every field above is built in code and tested.
