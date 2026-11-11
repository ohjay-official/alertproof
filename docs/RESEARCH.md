# Research Before Brainstorming (Nov 11, 2026)

## Last Year (Dakar Bitcoin Hack 2025)

- 21 projects, 199 participants. Teams of 2 to 5 were required (not this year).
- Judges: Nourou (Banxaas), Alphonse Mehounme (PlanB Africa), Loïc Kassamoto (Bitcoin Benin), Kelvin Isievwore (Btrust), Tobechi Chukwuleta (BTCPay Server), Abdullahi Yunus (Btrust).
- Weights: usefulness and local impact 40%, security by design 30%, UX/UI 20%, working MVP 10%.
- **1st GandalNexus**: BitQuest (learning missions with rewards) and BitLab (Testnet practice). Still building BitLab in Oct to Nov 2026 (real wallets, LDK Lightning in the browser, French first, 97 tests). Likely to re-enter.
- **2nd PaySats**: Flutter wallet linking Lightning and mobile money, savings vaults (Tabaski). The code simulates every payment with delays; built in about 9 days. Placed on local fit when MVP was only 10%.
- **3rd BitTravel**: intercity bus tickets; real BTCPay Server invoices, signed QR tickets, trilingual assistant (French, English, Wolof), live site.
- Not placed: CryptoFaye (Lightning wallet teaching in Wolof and French), TANGA (SMS wallet), Lynq, JàngBokk, BitQuine (AI trading), KassoLightning, DioteKo (later 2nd at Bitnob Dakar 2026).

## This Year's Changes

- Working MVP now asks for one-command setup, seed data and a testable happy path; new criterion "Clear Pitch & Docs".
- Rules: judges mainly focus on an MVP that can be tested. Must reside in Africa. Solo entry confirmed allowed.
- Scope: tools for African people on Bitcoin, Lightning, Nostr and AI.

## Judges 2026

- **Nourou (Mouhamadou Kouta)**: Chaincode-trained Bitcoin developer; Bitcoin Senegal (Wolof education); Dakar Bitcoin Days; Banxaas (Lightning to mobile money in Senegal, Ivory Coast, Guinea, Cameroon, Kenya; almost 7M CFA in its first five months). Won 1st overall at bitcoin++ Nairobi (June 2026) with WestToEast by doing a live payment on stage; hides Bitcoin from the user. Has said low literacy is one of the biggest barriers.
- **Kelvin Isievwore**: Btrust Head of Engineering; RootstockLabs 2021, Qala first cohort, full-time open source 2023, grantee 2024. Ensures code and developer quality. Values persistence and solving hard problems. Talk: responsible AI practice in Bitcoin open source. Judged Dakar 2025 and bitcoin++ Nairobi 2026.
- **Peter Tyonum**: Btrust Builders first cohort; BDK ecosystem maintainer (bdk-cli, wallet libraries); built a Bitcoin inheritance app and a multisig custody service; HRF grantee; Lagos-based.
- **Yogen Ghodke**: AI agent engineer at Hexaware (LangChain, multi-agent, testing agentic AI); built ListenToMe (study documents to audio for a visually impaired student, about 30 languages, deletes documents after processing); judges student Devpost hackathons.

## Related Hackathons

- **bitcoin++ Nairobi 2026** (Kelvin judged; expo format, 3 minutes max): 1st WestToEast (mobile money cross-border over Lightning), 2nd Robin (guides newcomers to open source), 3rd nairobi2 (ridesharing); Hodlr (timelock savings) best beginner; LNpesa (USSD agent tool).
- **Bitnob Code & Chain Dakar, Oct 2026** (Btrust-backed): 1st RAK TAK CASH (merchant Lightning, secures buyer and seller), 2nd DioteKo, 3rd BitBounty (dropped mobile money payouts: they won't work for hackathon builders).
- **Hack4Freedom 2025** (Btrust-sponsored, Nigerian women): 1st bounties and gigs with escrow, 2nd BTC savings tracked in naira, 3rd airtime and bills.

## This Year's Field (21 entries on Nov 11)

Four savings circles, three shop payment apps, remittances (SatsFlow), scam-warning wallet (Zafy), aid vouchers, AI payment copilots, paid AI inference, and five generic AI projects from one entrant.

## Prior Art For The Chosen Idea (AlertProof)

Name: AlertProof (working name was Dëgg, dropped for a name anyone gets at once). "Proof" alone was too generic and Konfam is taken by a Nigerian product.

- **Numo** (github.com/cashubtc/numo, by the Cashu team): Android point-of-sale app. The merchant types an amount and the phone emulates an NFC tag holding a Cashu payment request; the payer's wallet writes a token back. Also Lightning invoices, Nostr payments, auto-withdraw to a Lightning address after a threshold, item catalogs. Its merchant must be online: its offline screen says new charges can't start until the phone is back online, and a payment made while offline is confirmed once back online. The code redeems tokens online and does no DLEQ check. So it is the mirror image of AlertProof (customer offline vs trader offline). Lessons to take: plan for flaky shop Wi-Fi, keep onboarding short, confirm results with haptics, auto-withdraw so little sits at the mint. Phone-to-phone tap needs a native app with card emulation, which is why AlertProof uses a written NFC sticker instead.
- Offline receive of Cashu ecash is a live topic: cashu-ts kept the DLEQ on offline sends (PR #1383, Nov 7, 2026); CDK issue #1927 asks for offline receive; cashu-vpn verifies P2PK-locked proofs offline against cached mint keys; Cashu Card does offline NFC payments.
- Nobody in this year's field lets a trader with no data confirm a real payment. Fake credit alerts are a widely reported problem for Nigerian traders and POS agents.
- Lightning can't pay an offline receiver yet (async payments, bolts#1149, still open).

## Sources

- https://dakar-bitcoin-hack-2026.devpost.com/ and /rules and /project-gallery
- https://dakar-bitcoin-hack-26476.devpost.com/ (2025)
- https://nourou.substack.com/p/dakar-bitcoin-days-iii-le-bilan
- https://github.com/GandalNexus/bitlab, https://github.com/ibou-dia/PaySats, https://devpost.com/software/bittravel
- https://nourou.substack.com/p/how-i-accidentally-won-a-hackathon
- https://insider.btcpp.dev/p/bitcoin-nairobi-hackathon-garners, https://foss.devpost.com/
- https://blog.btrust.tech/announcing-the-new-btrust-engineering-lead/
- https://blog.btrust.tech/what-happens-after-your-first-merged-pr/
- https://btcpp.dev/whois/kelvinator07
- https://bitcoindevkit.org/foundation/grantees/, https://github.com/tvpeter
- https://hexaware.com/blogs/prompt-driven-development-coding-in-conversation/
- https://www.artiverse.ca/listentome-turns-study-documents-into-audio-for-more-students/
- https://pro.edgex.exchange/en-US/news/article/bitnob-bitcoin-hackathon-dakar
- https://github.com/Djbrl/bitbounty/pull/102
- https://github.com/cashubtc/cashu-ts/pull/1383
- https://github.com/cashubtc/cdk/issues/1927
- https://github.com/robwoodgate/cashu-vpn
- https://guardian.ng/?p=2180555
- https://github.com/cashubtc/numo
