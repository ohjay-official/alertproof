# Sealpay: 60-second film

**What it must prove:** a trader with no data knows a payment is real before the goods leave, and a fake or reused receipt can't fool them.
**Money shot (first 10 seconds):** the trader's phone in airplane mode turns green: **Paid, ₦2,000**, and says it out loud.
**Music:** Match Out, artbybigvee (Pixabay Content License). Upload unlisted first and check for claims.
**Amounts:** use the live rate on the day (₦2,000 was about 2,300 sats on Nov 16). Never the old 1,333.

## Time budget (follows the judging weights: working MVP and usefulness first)

| Seconds | On screen | Text on screen |
|---|---|---|
| 0 to 4 | Trader phone, airplane mode icon visible, green **Paid** stamp lands | "Paid. ₦2,000. No data." |
| 4 to 10 | Black card | "Fake credit alerts cost traders their goods. 52% of Lagos market traders surveyed have seen one." (source on the end card) |
| 10 to 18 | Trader types **2000** on the keypad, taps **Show pay code** | "The trader types the price." |
| 18 to 28 | Customer phone scans the code, taps **Pay ₦2,000**, pays from their Lightning wallet, receipt QR appears | "The customer pays from any Lightning wallet." |
| 28 to 36 | Trader taps **Scan their receipt**, airplane mode still on: green **Paid**, phone buzzes and speaks | "Checked on the trader's phone. No internet." |
| 36 to 44 | Same receipt again: red **Already used**. A faked one: red **Not paid** | "A copied or faked receipt can't pass." |
| 44 to 52 | Data back on: **Sales**, **Collect**, then **Cash out** | "Collected later, to the trader's own wallet." |
| 52 to 60 | End card | "Sealpay. Payments a fake alert can't fake." sealpay-beta.vercel.app, github.com/ohjay-official/sealpay, source line for the 52% |

## Shot list for your phones (numbered, record each as its own clip)

Trader phone = your Android. Customer phone = your iPhone. Turn notifications off on both (Do Not Disturb). Clean demo data first: in the trader app, Sales, **Leave the demo**.

1. Trader phone: open sealpay-beta.vercel.app/app#demo once with data (it sets up the demo stall). Then turn **airplane mode on**. Start screen recording.
2. Trader: type **2000**, tap **Show pay code**. Hold 2 seconds. Stop recording.
3. Customer phone, with data: start screen recording. Open the camera, scan the trader's pay code, open the link, tap **Pay ₦2,000**. On the test mint it pays itself in a few seconds. Hold on the receipt QR for 3 seconds. Stop.
4. Trader (airplane mode still on): start recording, tap **Scan their receipt**, point at the customer's receipt QR until it turns green and speaks. Hold 3 seconds. Stop.
5. Trader: tap **Scan again**, scan the same receipt: **Already used**. Stop.
6. Trader: tap **Demo: try a faked receipt**: **Not paid**. Stop.
7. Trader: airplane mode off. Tap **Sales**, **Collect 1 payment**, PIN **1234**. Hold on "Collected". Stop.
8. A 3-second clip of the airplane mode icon in the status bar, for the opening.

Send me the clips as they are; I cut them to the beat. Before sending, check nothing private is on screen: no personal wallet balance, no messages.

## The 3-minute pitch (outline; the rules ask for problem, solution, impact, next steps)

1. **Problem (30 s):** fake alerts and edited screenshots at Lagos markets (Punch survey numbers), slow real alerts on bad networks, POS agents as targets (about 2 million in Nigeria, AMMBAN). What the 5 traders said.
2. **Solution (60 s):** the live demo from the film, network off. One line on how: the mint signs the payment, it's locked to the trader, the phone checks both by itself.
3. **Impact (45 s):** measured numbers (0 bytes per check, 46 KB per payment, 47 KB app, 2.4 s on slow 3G), who it reaches (traders, POS agents; 218,583 active mobile-money merchants in Senegal, BCEAO), the trader visits.
4. **Next steps (45 s):** pilot near school, real-money cash-out to naira and CFA, NFC sticker, upstream contribution to Cashu (CDK #1927).
