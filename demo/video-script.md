# Wayfare demo video (about 2:45)

One story: **your NEAR pays for a whole trip, an AI agent books it, and it never touches your money.**
Record at 1440×900. Start from a fresh `pnpm demo` (the trip wallet shows 0.00 USDC). Speed up the browsing parts 4–8×; keep the moments where NEAR acts at normal speed.

| # | Time | On screen | Voiceover |
|---|---|---|---|
| 1 | 0:00–0:15 | Home page hero, cursor still | "AI agents can book travel now. But to pay, you have to hand them your card or your keys. Wayfare is a travel agent that never holds either." |
| 2 | 0:15–0:30 | Click the **Bangkok → Kyoto** chip, then **Plan my trip** | "I ask in plain words: fly Bangkok to Kyoto, two nights near Gion, sushi for two, a thousand dollar budget." |
| 3 | 0:30–0:55 | Run page: the agent's browser searching Kumo Air, Kiseki Rail, Lantern Stays, Sumi Table (sped up), the activity feed scrolling | "The agent opens four real booking sites in a browser, compares the options, and plans the flight, the train, the ryokan and dinner." |
| 4 | 0:55–1:15 | The plan with its four items and reasons; zoom on the on-ramp line and the **Fund with 2.7 NEAR & book** button | "Before anything is paid, I approve the plan once. The price comes live from NEAR Intents: about 2.7 NEAR buys the ten dollar budget in USDC on Base." |
| 5 | 1:15–1:30 | Click approve; the **Funded 10.00 USDC** card appears | "My NEAR funds a trip wallet on Base. Its key is held by NEAR's MPC network, and only the Wayfare contract can ask it to sign." |
| 6 | 1:30–1:55 | Bookings confirming one by one (sped up), each with its NEAR signature | "Each site asks for an x402 payment. The agent can only ask. The NEAR contract checks the merchant, the price cap and the budget, then the MPC network signs the USDC." |
| 7 | 1:55–2:10 | Click **Let the agent try a pricier room**; the red **refused by NEAR** card | "What if the agent goes off-plan? It tries a pricier room. The contract refuses, on chain, and nothing is signed." |
| 8 | 2:10–2:25 | Click **End trip & return 2.26 USDC**; the return card shows NEAR coming back | "When the trip ends, the agent loses access and the unspent budget is swapped back to NEAR, into my savings." |
| 9 | 2:25–2:45 | Scroll to **How the money moved**, hold on the diagram; then the On-chain record | "NEAR savings, trip wallet, merchants, and back to NEAR. Chain Signatures for the payments, NEAR Intents for the swaps, and a contract that enforces the plan. That's Wayfare." |

## Before recording
- Run one trip off camera first so the home page has a "Latest trip" preview.
- Check the traveler has at least 6 testnet NEAR (Savings row on the wallet card). If not, run `pnpm -C agent topup`.
- Close other apps (low RAM); use one browser window.
- If a NEAR Intents quote is slow, wait for the on-ramp line before clicking approve.

## Say once, plainly (for trust)
NEAR Intents has no testnet. The quotes are live mainnet prices, and the NEAR transfers are real testnet transactions. The solver's side of each swap is simulated, and the page says so. Mention this over shot 5 or in the description, not as an apology.
