# Wayfare: plan (draft for approval)

> **"Tell an AI your trip. It plans it, books it and pays for it, on any chain, and it never holds your card or your keys."**

Working name: **Wayfare**. Alternatives: Passage, Farepass, Tabi.

## The problem

AI agents can already plan trips, but nobody lets one *book* and *pay*. Handing an agent your card number, your passport and an open wallet is too risky, so a human still clicks "pay" on every booking.

## The idea

- A NEAR contract is the agent's wallet.
- The agent can ask it to pay, but only the contract can sign, and only for the trip you approved, within your budget and at merchants you allowed.
- Booking sites charge the agent over **x402** (HTTP 402 "payment required").
- The contract signs the payment on the merchant's chain using **NEAR Chain Signatures**. Base Sepolia was tested on 2026-11-05.
- Your passport and preferences stay in an encrypted vault the agent can read only for this trip.

## Demo flow (what judges see)

1. **Ask.** "Tokyo to Kyoto next Friday, 2 nights near Gion, sushi dinner Saturday, under 300 USDC."
2. **Plan.** The intent parser turns this into a structured trip: a train, a hotel, a restaurant and a total. You approve once, and the plan's hash and budget are stored on NEAR.
3. **Book.** agent-browser opens each booking site, searches, picks an option within the plan and fills in the guest details (read from the vault).
4. **Pay.** Each checkout answers `402`. The agent asks the contract to pay. The contract checks the trip, budget and merchant, then signs. The x402 service settles USDC on Base Sepolia, and a real transaction link appears on screen.
5. **Refused.** The agent tries a hotel upgrade that breaks the budget. The contract refuses, and this shows on screen with the reason.
6. **Revoke.** You hit "End trip". Vault access and the remaining budget close in one NEAR transaction.
7. **Receipt.** One trip page shows every booking, payment, NEAR transaction, Base transaction and vault read.

## Parts

| Part | What it does | Built from |
|---|---|---|
| **Trip contract** (NEAR, Rust) | Trips (plan hash, budget, allowed merchants, expiry). `pay()` builds the USDC EIP-3009 payment itself, checks the rules and calls the MPC signer; `end_trip()`; vault grants and read receipts | New. The tested `paycap` contract plus grant logic from Strongbox and spending rules from Tillpoint |
| **Booking sites** (4) | Rail, hotel, flight and dining sites that look like real booking sites. Checkout uses x402 on Base Sepolia through the public x402.org service | New, one small Next app with 4 sites |
| **Agent** | Intent parser, then plan, then agent-browser booking, then x402 pay loop and evidence. OpenAI brain with a scripted fallback | Guildhall agent (browser.ts, brain.ts, evidence) plus Trellis-style intent parsing |
| **Vault** | Traveler profile (name, passport no., loyalty IDs), encrypted on the client; the agent's read is checked by the contract and logged | Strongbox ideas, simplified into the trip contract |
| **Web app** | Pages: Ask, Trip (live booking timeline with payment links), Wallet and rules, Vault | Guildhall web (current terminal/pixel theme) |

## Real vs simulated (we say this openly)

| Real | Simulated |
|---|---|
| NEAR testnet contract and rules | Booking sites are our demo sites, not real hotels |
| NEAR MPC signatures (Chain Signatures) | |
| USDC payments on Base Sepolia through the real x402 service | |
| The agent driving a real browser | |
| NEAR Intents: *pitch only*. It's the mainnet path for paying from any token, but it has no testnet so we don't demo it live | |

## Cross-chain

- **Must have:** pay on Base Sepolia, signed from NEAR. Tested.
- **Stretch:** pay one merchant on Solana devnet with the same contract (Ed25519 Chain Signatures). The x402 service supports it. Needs one more check before we promise it.

## What changes in Guildhall

- **Keep:** agent-browser tooling, the OpenAI/scripted brain, the evidence manifest, the web shell and theme, the live feed and the hub.
- **Drop from the main story:** the sealed-bid auction and the Hacker News and helpdesk jobs. The auction could come back later as "agents compete to plan your trip", but it isn't needed to win.
- **Replace:** the Guildhall contract with the Trip contract.

## Build order

1. Trip contract: trips, `pay()` with rules, `end_trip()`, vault grants. Unit and sandbox tests.
2. One booking site (hotel) with x402 checkout, plus an x402 client in the agent that pays through the contract. First real payment on Base Sepolia.
3. Intent parser to an approved plan, with the plan hash stored on chain.
4. The other three sites, and the agent booking a full trip.
5. Vault plus revoke.
6. Web app pages.
7. Solana stretch, if checked.
8. README, e2e test, video.

## Your input needed

1. **Name.** Wayfare, or another?
2. **Auction.** Drop it (recommended) or keep it?
3. **Test USDC.** You claim free Base Sepolia USDC from faucet.circle.com for the contract's wallet. It has a captcha; I'll give you the address when step 2 is ready.
