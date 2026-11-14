# Wayfare

**Tell an AI your trip. It plans it, books it and pays for it, on any chain, and it never holds your card or your keys.**

NEAR Hackathon 2026 · Track: **Agent Economy**

**Demo video (2:59):** _add link_ · **Try it without installing:** [wayfare.autos](https://wayfare.autos) (replay of 3 real trips)

## The problem

To book and pay for you, an AI agent today needs your card or your wallet keys, and then you hope it behaves. One bad prompt and it can spend everything.

## Wayfare's answer

The agent only *asks* to pay. A NEAR contract holds the signing power and signs a payment only if it matches the plan you approved: right merchant, right item, right price, before the trip ends. Anything else is refused, and the refusal is recorded on NEAR.

```
 you: "Bangkok → Kyoto, 2 nights, sushi for two, $1,000"
   │
   ▼
 agent (or any AI via MCP) ── browses 4 booking sites ──► plan
   │                                                        │ you approve once (NEAR funds it, via NEAR Intents)
   ▼                                                        ▼
 checkout says "402: pay in USDC" ──► agent asks the Wayfare contract on NEAR
                                          │ in the plan?  yes → NEAR MPC signs (Chain Signatures)
                                          │               no  → refused, logged on-chain
                                          ▼
                        x402 payment settles on Base, Arbitrum or NEAR
```

One trip pays on three chains: the flight and train in USDC on Base, the hotel on Arbitrum, the dinner on NEAR itself. The trip wallet's keys are held by NEAR's MPC network under the contract: one address on every EVM chain (secp256k1), and an implicit NEAR account (ed25519) for x402's NEAR scheme (`@x402/near`).

What one trip shows:
- **One approval funds everything.** Your NEAR is swapped to USDC on each chain the trip needs, priced live by NEAR Intents.
- **x402 on 3 chains.** Every merchant is paid with standard x402, and the contract signs each payment.
- **Disruptions are handled.** The airline cancels and refunds, and NEAR checks the airline's signature before the refund counts. The agent sees the train no longer connects and rebooks both, within the +20% you allowed.
- **Off-plan means no signature.** The agent tries a pricier room and the contract refuses to sign.
- **The money comes home.** When the trip ends, what's left on every chain is sent back and swapped to NEAR.
- **Any AI agent can use it.** Wayfare is an MCP server, so Claude or Cursor can book a trip with the same guardrails (see below).

## Proof: one trip on NEAR testnet

Trip #25 on `wf.ghcsmw3fimg2.testnet`, one full run of the demo (the video shows the same flow, trip #33):

| Step | Transaction |
|---|---|
| Traveler approves the plan (budget 10 USDC, plan hash on-chain) | [ARZPdpGm…](https://testnet.nearblocks.io/txns/ARZPdpGmujKxKqxVbqTgktSsEKyqnudMgddujZoMDpjz) |
| NEAR deposit funds the trip (NEAR Intents quote) | [9efz1tgj…](https://testnet.nearblocks.io/txns/9efz1tgjh6B8cwbcNhxi1HjY4dCpUfrkxrNejfYxQag2) |
| Contract signs the dinner payment (MPC, ed25519) | [G61Udtao…](https://testnet.nearblocks.io/txns/G61UdtaoFCW9Qpi6L2ANRzvDzKE284akDZV9zqb2uQjr) |
| x402 on NEAR: the facilitator relays it, USDC reaches Sumi Table | [ECZVrgew…](https://testnet.nearblocks.io/txns/ECZVrgewbbXB4mUmpPfXNt9x11RbJ48F8uvnfvt6cuZZ) |
| Kumo Air's signed cancellation is checked and recorded | [FYN2YyMH…](https://testnet.nearblocks.io/txns/FYN2YyMHFjttvGm35iLBNGTket4gmBjxdnptfSo8PSa1) |
| Traveler ends the trip: the agent can no longer pay | [FB9M7RUj…](https://testnet.nearblocks.io/txns/FB9M7RUjvYAj8SSxFFyF3oZ4h6tv8umLprz25yaVDqH2) |
| Leftover 2.18 USDC comes home as 0.5811 NEAR | [H95kydAz…](https://testnet.nearblocks.io/txns/H95kydAzuhUMVgUtC95xokuhPn8NACwK1Ybk7XZCKafo) |

Check the whole trip yourself: `near view wf.ghcsmw3fimg2.testnet get_trip '{"trip_id":"25"}' --networkId testnet` (budget, spent, `refusals: 1`, plan hash, receipt chain head), and `get_trip_payments` for each signed payment.

### Proof: a real x402 service we don't run

The same NEAR-checked path pays a public, third-party x402 API: a live weather service listed in the [x402 Bazaar](https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources), on the real Base Sepolia. Trip #28: the traveler approves one item ("current weather in Kyoto", at most 0.01 USDC), the agent calls the API, gets `402`, the Wayfare contract checks the item and NEAR's MPC network signs, and the service's own facilitator settles. The agent gets Kyoto's weather back.

| Step | Transaction |
|---|---|
| Weather API registered as a merchant (its pay-to address fixed on-chain) | [59UEzjHm…](https://testnet.nearblocks.io/txns/59UEzjHm6y3sU5tDfmaYRZct3ACbpwQrNceNoWUzeZYQ) |
| Traveler approves trip #28 (one item, cap 0.01 USDC) | [CNZWvJsG…](https://testnet.nearblocks.io/txns/CNZWvJsGRAu7G2zWYxVa84c5qJZ3JXg2cqyTDyQ5hQDk) |
| Contract checks the item, MPC signs 0.001 USDC | [B2ocBCGg…](https://testnet.nearblocks.io/txns/B2ocBCGgUzqHuDcc9Qa7JeiZeesq1zfgxtQEVZZZcL2E) |
| The service's facilitator settles on the real Base Sepolia | [0x7a40784b…](https://sepolia.basescan.org/tx/0x7a40784be93f2f297b59dd3029bb22c26f02b4a65a64a56768b1cda38482fbb8) |
| Settlement recorded on the trip | [GP2Kts1H…](https://testnet.nearblocks.io/txns/GP2Kts1HgGmjsUK4LTYJ3fMpRaZZyyHc4Fem8GTitrcj) |

Run it again: `pnpm -C agent pay:real` (`CITY=Tokyo` for another city). It needs a little test USDC in the trip wallet on Base Sepolia ([faucet.circle.com](https://faucet.circle.com)); no ETH, the facilitator pays gas.

## What is real and what is simulated

| Part | Status |
|---|---|
| Wayfare contract, its rules, refusals, receipt chain | **Real**, NEAR testnet |
| Signatures for the trip wallet | **Real**, NEAR's MPC signer (`v1.signer-prod.testnet`), secp256k1 + ed25519 |
| x402 on NEAR (the dinner) | **Real**, NEAR testnet: Circle testnet USDC, the official `@x402/near` facilitator, relayer pays gas |
| x402 on Base and Arbitrum | Local forks of Base Sepolia and Arbitrum Sepolia by default. `WAYFARE_CHAIN=live` uses the public testnets and the x402.org facilitator |
| NEAR Intents prices | **Real** live 1Click quotes (mainnet, dry run: nothing is sent to mainnet) |
| NEAR Intents delivery | Simulated: Intents has no testnet, so a pool account (the contract account) plays the solver |
| Traveler's NEAR deposit and payout | **Real** NEAR testnet transfers |
| Booking sites | Four demo sites we built, each a real x402 server; prices are 1/100 scale |
| A third-party x402 service | **Real**: a public weather API from the x402 Bazaar, paid through the contract and settled on the real Base Sepolia by its own facilitator (trip #28) |
| The agent | **Real** browser (`agent-browser`); the AI brain is OpenAI if a key is set, simple rules otherwise |

## Use Wayfare from any AI agent (MCP)

Wayfare is also an MCP server, so other agents can book through it. The calling agent gets no keys and no money. It can plan, follow, try things and end a trip, but it **cannot approve a budget**: it gets a link and the traveler approves. After that, the NEAR contract enforces the plan whichever agent is asking.

```bash
pnpm demo                                                     # Wayfare running on :3400
claude mcp add wayfare -- pnpm --silent -C "$PWD/agent" mcp   # Claude Code; any MCP client works the same way
```

| Tool | What it does |
|---|---|
| `wayfare_status` | Traveler, trip wallet balances on each chain, merchants |
| `plan_trip` | One sentence → Wayfare browses the sites and proposes a plan; returns the approval link |
| `get_trip` | Plan, bookings with NEAR signature and settlement links, disruptions, what to do next (`wait_seconds` follows long steps) |
| `list_trips` | Recent trips |
| `try_upgrade` | Ask for a pricier room: the contract refuses, on-chain |
| `simulate_cancellation` | Demo: the airline cancels; refund, fix, rebook within the rule |
| `end_trip` | End the trip on NEAR; leftovers come home as NEAR |
| `verify_trip` | Read the trip straight from the contract: budget, plan hash, signed payments, refusals |

`WAYFARE_URL` points it at another Wayfare (default `http://localhost:3400`).

Tested end to end: trip #27 was driven only through these tools. The steps were `plan_trip`, then the traveler's approval ([2Wdth9zR…](https://testnet.nearblocks.io/txns/2Wdth9zRY6efJppNyaSCFeURDaMYifrwbDuuPp4eF5vR)), then `simulate_cancellation`, `try_upgrade` (refused by the contract), `end_trip` ([FpoQDNbe…](https://testnet.nearblocks.io/txns/FpoQDNbeSBcQWQutPk2T1uMKymjLsJnxUU6ErK8fhksA)) and `verify_trip`. The trip paid on 3 chains and 2.18 USDC came home as 0.5708 NEAR ([aACCsvbZ…](https://testnet.nearblocks.io/txns/aACCsvbZCei27D4Kstf9uCXERBqTcL4QUM2poK3MZWe)).

## Run it

You need Node 22.9+, pnpm, [Foundry](https://getfoundry.sh) (for `anvil`) and Chrome. If you don't have Chrome, run `pnpm -C agent exec agent-browser install` once. You don't need Rust or a NEAR account.

```bash
pnpm setup                     # installs agent, sites, web
pnpm -C agent setup:testnet    # once: creates a NEAR testnet account with free faucet NEAR, deploys the contract, writes .env
pnpm -C web build              # optional: the web app starts faster
pnpm demo                      # local Base fork, the 4 sites, the agent hub, the web app → http://localhost:3400
```

`setup:testnet` deploys the prebuilt contract in `contracts/wayfare/res/wayfare.wasm`, or your own build if `contracts/target` has one (see Tests). It's safe to run again. Each trip uses about 3 testnet NEAR; `pnpm -C agent topup` gets more from the faucet.

Optional settings in `wayfare/.env`:
- `OPENAI_API_KEY`: the AI brain. Without it, simple rules parse the request and choose the options.
- `ONECLICK_JWT`: a NEAR Intents 1Click key (partners.near-intents.org), for higher rate limits on price quotes.

**Web app (`web/`, :3400):**
- **Plan a trip:** type the trip in plain English. The page also shows the travel wallet: its USDC, and that its key is held by NEAR MPC under the contract.
- **Run page** (`/run?id=`): the progress track; the agent's browser (screenshots as it searches, chooses, fills and pays); the activity feed; the plan with each choice's reason; **Approve & book**; each booking's confirmation, NEAR signature and settlement; **Kumo Air cancels the flight** (see below); **Let the agent try a pricier room** (the contract refuses); **End trip**. The *On NEAR* panel reads the contract: limits, signed payments, vault reads and the receipt chain head.
- **Trips:** every run.

**Replay (a link anyone can open):** `node web/scripts/replay.mjs [run-id …]` (with the demo running) builds `web/out/`: the same web app, read-only, with real trips saved as static files. Every payment, refund and refusal still links to its NEAR testnet transaction. Host the folder anywhere (Netlify Drop, Vercel, GitHub Pages; set `NEXT_PUBLIC_BASE_PATH=/<repo>` for a Pages project site). Live copy: [wayfare.autos](https://wayfare.autos). On Vercel, add a `vercel.json` with `{"cleanUrls": true}` so `/run?id=…` and `/trips` load.

The hub (`agent/src/hub.ts`, :7373) runs the agent behind `/api/status`, `/api/runs` (POST to start), `/api/runs/<id>` and `/api/runs/<id>/{approve,cancel,upgrade,disrupt,approve-rebook,end,return,quote}`, and `/api/trips/<id>`. It runs one trip at a time (one browser).

## Contract (`contracts/wayfare`)

Each traveler gets a wallet on Base and Arbitrum, and one on NEAR, whose keys are held by NEAR's MPC network (Chain Signatures) under this contract's account and the path `wayfare/<traveler>` (secp256k1 for the EVM chains, ed25519 for NEAR). Only the contract can ask for a signature, and it only does so within the trip's rules.

| Method | Who | What |
|---|---|---|
| `new(owner, mpc, networks)` | deployer | `mpc`: `v1.signer-prod.testnet` / `v1.signer`. Networks: CAIP-2 id plus the USDC contract and its EIP-712 name/version |
| `add_network` · `add_near_network({id, label, token})` · `add_merchant(id, name, category, network, pay_to, url)` · `set_merchant_active` · `set_merchant_network` · `set_merchant_payee` | owner | Merchant registry. The agent can only pay a merchant's registered `pay_to` (an EVM address, or a NEAR account on `near:testnet`) |
| `set_wallet(address)` | traveler, 0.01 NEAR | Registers the EVM address of the MPC key at `wayfare/<you>` |
| `set_near_wallet(public_key)` | traveler, 0.01 NEAR | Registers the ed25519 key the MPC network holds at `wayfare/<you>` (domain 1); its implicit account is the trip wallet on NEAR |
| `create_trip({agent, title, plan_hash, budget, items, vault_fields, duration_sec, rebook_pct?})` | traveler, 0.25 NEAR | Items are `{merchant_id, label, max}` and must fit the budget. `rebook_pct` (0-100): how much more a replacement may cost, if a merchant cancels, without asking the traveler |
| `pay({trip_id, item, amount, nonce, valid_before})` | the trip's agent, 250 Tgas+ | Checks the trip is active, the merchant, the item's approved price and the budget. Builds the USDC `TransferWithAuthorization` itself, asks the MPC signer, and returns the x402 `authorization` plus a 65-byte `signature`. For a merchant on NEAR it builds a NEP-366 delegate action holding one USDC `ft_transfer` (1 yoctoNEAR, 30 Tgas) to the merchant's account instead; `nonce` is the delegate-action nonce and `valid_before` its max block height (≤ 900 blocks ahead); the MPC network signs it with ed25519 and the answer carries the delegate action (`near`). Outside the rules it returns `refused` with a reason and logs it; nothing is signed |
| `record_read(trip_id, fields, purpose)` | the trip's agent | Logs a vault read; only granted fields, only while the trip is active |
| `report_settled(payment_id, tx_hash)` | the trip's agent | Records the transaction that settled a payment (0x hash on Base/Arbitrum, base58 hash on NEAR) |
| `end_trip(trip_id)` | traveler | Stops payments and vault reads at once |
| `record_cancellation(trip_id, payment_id, booking_ref, refund, refund_tx, signature)` | anyone (the agent) | A merchant cancelled and refunded a booking. Counts only if the merchant's registered payment key signed the cancellation (EIP-191, checked with `ecrecover`) for a payment this trip settled with it, so the agent can't invent a refund. The refund goes back into the budget, and the item may be rebooked for up to its price plus the trip's `rebook_pct` |
| `approve_rebook(trip_id, item, max)` | traveler | Lets the agent pay up to `max` for a cancelled item's replacement, when it's over the auto-rebook limit |
| `withdraw({network, to, amount, nonce, valid_before})` | traveler | Moves the traveler's own USDC out, without trip rules (on any chain, NEAR included) |

**Safety:**
- A signed authorization lives at most 15 minutes and never past the trip's end.
- Each `(wallet, nonce)` is signed only once; on NEAR each new delegate action needs a higher nonce than the last one signed.
- High-s signatures from the signer are normalized to the low-s form Ethereum requires.
- If signing fails, the reserved amount goes back to the trip.
- Every trip event is folded into `receipt_head` = sha256(previous head + "\n" + event log line). Re-hash the logs to check nothing was left out.

Views: `get_config`, `get_merchants`, `get_merchant`, `get_wallet`, `get_near_wallet`, `get_near_authorization`, `wallet_path`, `get_trip` (with `phase`: active / expired / ended), `get_trips`, `get_traveler_trips`, `get_payment`, `get_trip_payments`, `get_read`, `get_trip_reads`, `can_read`.

Amounts are USDC base units (6 decimals). Times are nanoseconds unless a name says `_sec`.

## Tests

```bash
cd contracts
cargo test -p wayfare                       # 44 unit tests: rules, EIP-712 hash vs viem, NEP-366 delegate action vs near-api-js, signature normalizing, receipts, cancellations, three chains
(cd wayfare && cargo near build non-reproducible-wasm --no-abi)
(cd mock-signer && cargo near build non-reproducible-wasm --no-abi)
cargo test -p integration-tests             # sandbox: full trip with a mock MPC signer and the agent's function-call key
```

**Checked on testnet (2026-11-05) with the real signer `v1.signer-prod.testnet`:**
- `pay` was signed in about 23 s.
- The signature recovers to the traveler's derived wallet.
- Base Sepolia's USDC contract accepts it; the only error is the empty test wallet's balance.
- An over-price payment was refused with its reason.

**Checked on testnet (2026-11-06), paying on NEAR:** the contract built the delegate action for a 1.70 USDC dinner, `v1.signer-prod.testnet` signed it with the trip wallet's ed25519 key (domain 1), and `@x402/near`'s own decoder verified the `SignedDelegate`.

## Booking sites and x402 payments (testnet)

`sites/` holds four fictional merchants. Each is a plain Express site using the standard x402 server (`@x402/express`); none knows about NEAR, so any x402 client can pay them.

| Site | Port | What |
|---|---|---|
| **Kiseki Rail** | 4101 | bullet trains between Tokyo, Nagoya, Kyoto and Osaka |
| **Lantern Stays** | 4102 | hotels and ryokan · paid on **Arbitrum Sepolia** |
| **Kumo Air** | 4103 | flights across Asia (Bangkok, Singapore, Seoul, Tokyo, Osaka) |
| **Sumi Table** | 4104 | restaurant counters with prepaid courses · paid on **NEAR testnet** (x402 `exact` on `near:testnet`) |

Each one works the same way: search, choose, guest form (name, passport, email: the vault fields), then a booking page whose checkout `POST /api/bookings/<id>/pay` answers `402 Payment Required` with the booking's exact price. Once paid, the page turns to "Booking confirmed" with the transaction. Prices are 1/100 of real ones, and a banner says so.

`agent/src/x402-near.ts` uses the standard x402 client (`@x402/fetch` + `ExactEvmScheme`, and `@x402/near`'s `ExactNearScheme`) with the Wayfare contract as its signer. When the merchant asks for payment, the contract checks the trip rules and returns an MPC signature, or refuses.

**x402 on NEAR.** Sumi Table asks for USDC on NEAR testnet (Circle's NEP-141 `3e2210e1…b8af`). Its facilitator is the official `@x402/near` code running in the site: it checks the signed delegate action (one `ft_transfer`, right token, amount and recipient, unexpired, fresh nonce, enough balance) and relays it from `x402.<traveler>`, which pays the gas. On the agent's side the "signer" is the contract: it builds that delegate action from the trip's rules and the MPC network signs it for the trip wallet on NEAR. This leg is fully live on NEAR testnet, in both chain modes.

```bash
pnpm -C agent install && pnpm -C sites install
pnpm -C agent setup:testnet      # deploy/update the contract, agent account, merchant addresses, traveler wallet (writes .env)
pnpm -C agent topup              # free testnet NEAR for the traveler, when it runs low
pnpm -C agent chain              # local mode: forks of Base Sepolia (:8545) and Arbitrum Sepolia (:8546); the trip wallet starts empty (LOCAL_USDC=1000 pre-funds both, needed for pay:trip / pay:hotel)
pnpm -C sites start              # the four sites on :4101-4104
pnpm -C agent pay:trip           # approve a 4-item trip, book + pay flight, train, hotel, dinner via x402 + NEAR; an upgrade is refused
pnpm -C agent pay:hotel          # the same with just the hotel
```

**Chain modes** (`WAYFARE_CHAIN` in `.env`):
- **`local`** (default): anvil forks Base Sepolia and Arbitrum Sepolia with their real USDC contracts. The official x402 facilitator code (`x402Facilitator` + `ExactEvmScheme`) settles in the site's process. No funding needed. Payments are real transfers on the fork, not on the public chain.
- **`live`**: public Base Sepolia and Arbitrum Sepolia and the x402.org facilitator, with explorer links. The wallet needs faucet USDC (https://faucet.circle.com); `setup:testnet` prints its address and balance.

**Funding and returning money** (on-ramp and off-ramp, local mode):
- **On-ramp** (`agent/src/onramp.ts`): when you approve a trip, the trip wallet is topped up from your NEAR savings on each chain the trip pays on: each chain's bookings plus its share of the spare budget. One NEAR deposit, one live quote per chain. The price is a live NEAR Intents quote (1Click API, mainnet, dry run: nothing is sent to mainnet). The traveler's NEAR deposit is a real testnet transfer. NEAR Intents has no testnet, so the solver's side (USDC arriving in the trip wallet) is simulated on the local fork.
- **Off-ramp** (`agent/src/savings.ts`): ending a trip sends what's left on every chain back to your NEAR savings, one signed withdrawal per chain and one NEAR payout. The traveler calls the contract's `withdraw`, the NEAR MPC network signs a USDC transfer from the trip wallet to the NEAR Intents deposit address on Base, a relayer submits it, and the tx hash is reported back on NEAR. A live NEAR Intents quote (dry run) prices the USDC → NEAR swap, and the NEAR lands in the traveler's testnet account. NEAR Intents has no testnet, so the deposit address is anvil's public test account #1 and the solver's NEAR payout comes from the Wayfare contract account (which holds the on-ramp deposits). For live mode set `INTENTS_DEPOSIT_ADDRESS` (from a real 1Click quote) and `RELAYER_KEY`.
- So a trip's wallet goes 0 → budget → minus what merchants were paid → 0.

The NEAR side (contract, MPC signer, rules, and payments on NEAR) is real testnet in both modes. The on-ramp's NEAR leg is a real USDC transfer from a demo pool (the contract account, holding Circle faucet USDC: https://faucet.circle.com, NEAR Testnet), standing in for the NEAR Intents solver. Scripts use FastNEAR's testnet RPC (`NEAR_RPC`); the old rpc.testnet.near.org is deprecated and rate-limits.

## When a booking is cancelled

Press **Kumo Air cancels the flight** on a booked trip (a typhoon warning, in the demo):

1. Kumo Air cancels the booking, refunds the USDC to the trip wallet on Base, and signs a cancellation notice with its payment key (`POST /api/bookings/<id>/cancel` on any site).
2. The agent hands the notice to the contract (`record_cancellation`). NEAR checks the signature against Kumo Air's registered address and the exact payment it settled. Only then does the refund count, and the flight may be rebooked for up to its price plus your auto-rebook margin (chosen when you approve: 0, 10, 20 or 30%).
3. The agent searches Kumo Air again, skipping the cancelled flight. The new flight lands later, so the booked train no longer connects (a train must leave an hour after landing, checked in code). The agent asks Kiseki Rail to cancel the train, proves that refund on NEAR the same way, and picks a train that fits.
4. It books both replacements. If one costs more than your margin, the contract refuses it and the page asks you: **Approve** calls `approve_rebook`, then the agent finishes.

The run page shows each cancellation, the refund and its NEAR verification, the agent's reasoning, and the replacements. The money-flow diagram adds the refunds. Unspent money, refunds included, still goes back to NEAR when the trip ends.

## The agent: one sentence → a booked trip

```bash
pnpm -C agent trip "Fly me from Bangkok to Kyoto on 2026-11-19 for 2 nights, a ryokan near Gion, and a sushi dinner for two on the 21st. Budget $1,000."
#   --yes          approve without asking     --try-upgrade  then try a pricier room (the contract refuses it)
```

1. **Intent** (`agent/src/intent.ts`): OpenAI (`OPENAI_API_KEY`, `OPENAI_MODEL`, default gpt-4.1-mini) turns the sentence into a structured request with a strict JSON schema. It only uses places the merchants serve, and lists anything it can't book (e.g. "rent me a car") separately. Without a key, a small rule-based parser handles the common shape.
2. **Plan** (`planner.ts`, `sites.ts`): for each part, agent-browser opens the merchant, fills its search form and reads the result cards. The model picks the option that fits the request, the budget and what's already planned. Some rules are enforced in code, not by the model: for example, a same-day train must leave at least an hour after the flight lands. The agent then opens the choice and reads the exact total.
3. **Approve:** the plan's items, totals and budget become a trip on NEAR (`create_trip`); each item's total is its limit.
4. **Book** (`booker.ts`): the browser opens each choice and logs the vault read on NEAR (`record_read`) before filling name, passport and email. It submits, then pays the x402 checkout through the contract (`x402-near.ts`) and waits for "Booking confirmed".

Each run saves its evidence to `.data/trips/<run>/`: `activity.jsonl` (every step), `request.json`, `plan.json`, `result.json`, and screenshots of each search, choice, form and confirmation. The traveler's profile is in `.data/vault.json` (git-ignored; a demo profile is created on first use).
