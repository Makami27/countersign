# IDEA_CHECK

Date: 2026-10-30
Status: four candidates checked; **waiting on your pick.**
Read with: `anti-patterns.md`, `EVENT.md` (rubric), `LANDSCAPE.md` (field),
`knowledge/tatum-sui.md` (data limits found today).

## Data facts that decide these ideas (researched today)

| Fact | Source | Hits which idea |
|---|---|---|
| Sui address history (`transactions(filter: {affectedAddress})`) is served from a store with **~30–90 days typical retention**; point lookup by digest can be indefinite (archival) | [Sui GraphQL guide](https://docs.sui.io/guides/developer/accessing-data/query-with-graphql) | Tax classifier (needs a full tax year), Rules enforcer (needs trade history) |
| Tatum's wallet transaction-history API (`/v4/data/transaction/history`) **does not support Sui** | [Tatum reference](https://docs.tatum.io/reference/gettransactionhistoryv4.md) | all: history must come from Tatum's Sui GraphQL/gRPC |
| Tatum gRPC has no address-based transaction query (only by digest / checkpoint) | [Tatum Sui migration guide](https://docs.tatum.io/docs/sui-migration-guide-from-json-rpc-to-grpc.md) | all: use GraphQL for address queries |
| Tatum OHLCV includes **SUI**, one candle per call (no range), 50 credits each, intervals 1m to 1M; history depth unstated | [Tatum reference](https://docs.tatum.io/reference/getsymbolohlcv.md) | Tax, Rules (pricing every trade costs credits) |
| Tatum rate-history returns `price: 0` when it has no observation: indistinguishable from a real zero | [Tatum reference](https://docs.tatum.io/reference/getexchangeratehistorybysymbol.md) | Tax, Rules (must treat 0 as UNKNOWN) |
| Fake payment-proof scams are documented on Binance P2P, MEXC, OneKey, imToken, RedotPay, but **mostly about bank transfers**, which a chain can't verify | [malwaretips](https://malwaretips.com/blogs/?p=423520), [imToken](https://support.token.im/hc/en-us/articles/60310590083865-Beware-of-Fake-Transfer-Screenshots-Security-Monthly-Report-50th-Issue), [OneKey](https://blog.onekey.so/blog/ecosystem/stay-away-from-payment-proof-scams-ensuring-safety-in-c2c-trading) | Fake-alert checker (scope to on-chain payments) |

All of these get a reality spike against Tatum's gateway before we build (S6–S8 in REALITY_SPIKES.md).

---

## 1. Fake-alert checker ("Paid?")

**Track:** 2 Smart Agents (or 3 Consumer Finance).

### Hook
"They sent a screenshot. The chain says no."

### Who, the job, how they cope today, where it fails
A seller paid in stablecoins: a marketplace seller, a crypto OTC desk, a
freelancer, a small online shop. A buyer says "sent!" and pastes a screenshot
or a transaction link. Today the seller eyeballs a wallet app or an explorer
under time pressure while the buyer pushes them to release the goods. It fails
when the screenshot is edited, the link points at someone else's transfer,
the amount is short by fees, or the transfer is to a look-alike address.

### Hard core
A **payment verdict engine**: given a claim (amount, token, sender hint,
time window, optional digest), return exactly one of
`CONFIRMED | NOT_FOUND | SHORT | WRONG_RECIPIENT | AMBIGUOUS | UNKNOWN`.
- **Exactly-one matching:** two candidate transfers is `AMBIGUOUS`, never a pick.
- Each **digest can be claimed once**, enforced by a `UNIQUE` constraint. That stops replaying one real payment across two orders.
- **Finality:** only a transaction with `effects.status = success` in a checkpoint counts.
- Token identity is checked by **coin type**, not by symbol (fake "USDC" tokens).
- Any gateway timeout or 429 gives `UNKNOWN`, never `NOT_FOUND`.

### Thin-wrapper test
Without the model, every verdict still works: it's deterministic code over
Tatum reads. The model only reads a pasted screenshot or chat message and
*proposes* the claim fields (amount, digest, sender), which code then checks.

### Sponsor deletion test
| Sponsor | Removed → what breaks | On critical path? |
|---|---|---|
| Tatum Sui RPC | No verdict at all | yes |
| Walrus Memory | No counterparty history → no risk-adjusted checks, no "this buyer short-paid twice" | yes, *if* memory drives policy (below) |

### Where memory visibly changes the product
- Per-buyer record: confirmed / short / fake-claim history. A buyer with a fake claim on record gets a **stricter policy**: wait for N more checkpoints, require the digest, no "release on screenshot".
- **Learned scam patterns:** if a fake claim reuses another payment's digest, that pattern is remembered. The next check runs a "digest already claimed" test with an explanation that cites the earlier case.
- Seller preferences: tolerance for fee-short payments per token, remembered.

Without memory, every check starts from zero. That difference is the demo's before/after.

### Boundary
AI proposes: claim fields read from a screenshot or message.
Code decides: the verdict, the policy tier, whether to release.
The model never: says "paid", lowers a policy tier, or reads the amount *as the verdict*.

### The loop
claim arrives → fields proposed → chain checked via Tatum → verdict → seller acts → outcome (delivered / disputed) remembered → **next claim from this buyer runs a different policy**.
Step others skip: the dispute after release, and the honest `UNKNOWN`.

### What we deliberately do not claim
- Bank transfers: out of scope, said up front.
- Not identity verification (a confirmed payment doesn't say who the buyer is).
- No custody, no escrow.

### Risks
- **Bank-transfer reality:** most real fake-proof scams are fiat. We need a crisp "on-chain payments only" story. Pick a niche that is genuinely on-chain, like stablecoin sellers and crypto-native shops.
- Image reading adds a model step; it must stay *proposal only*.
- Neighbours: Veyra and SpendMemory check money you **send**. This checks money you **receive**, which is a clear line.

### Demo feasibility (solo, 11 days)
High. Two wallets: send real, short and wrong-token payments to yourself, then
forge a screenshot. Telegram bot as the channel.

### Rubric → proof map
| Criterion | Answer | Proof a judge can open |
|---|---|---|
| Integration 30% | Tatum is the verdict source; memory sets the policy | live bot + memory before/after |
| Technical 30% | verdict union, exactly-one matching, digest uniqueness, UNKNOWN handling | adversarial tests a judge can try live (paste a fake) |
| Creativity 20% | verifies *incoming* money; scam memory | — |
| Presentation 20% | "paste a fake, watch it fail" in 10 seconds | judge path |

**Score: strong. Lowest data risk of the four.**

---

## 2. Rules past-you wrote, enforced on present-you ("Precommit")

**Track:** 1 Markets & Prediction (or 3).

### Hook
"Past you made rules. Present you broke them. It noticed."

### Who, the job, how they cope today, where it fails
A retail trader on Sui DEXes who writes rules in a notes app ("no buying
after a 20% pump", "max 10% in one token", "no trades after midnight") and
breaks them on bad days. Nothing holds them to it, and nobody tells them what
breaking the rules cost them.

### Hard core
1. **Trade extraction:** a swap = one transaction whose balance changes for the wallet are negative in one coin and positive in another. Parse it from `effects.balanceChanges`. Ambiguous transactions (multi-hop, LP, airdrop + swap) are `UNCLASSIFIED`, never guessed.
2. **Rule engine:** a small typed rule language (threshold, position-size, time-of-day, cooldown) evaluated deterministically against each trade, with the price context from Tatum candles.
3. **Honest counterfactual:** "if you had kept the rule", computed with stated assumptions and labelled *counterfactual*, never as P&L.

### Thin-wrapper test
Passes: the engine, extraction and counterfactual are all code. The model only
turns a plain-English rule into the typed rule language, and the user
confirms it.

### Sponsor deletion test
| Sponsor | Removed → what breaks | On critical path? |
|---|---|---|
| Tatum Sui RPC + OHLCV | No trades, no prices, nothing to enforce | yes |
| Walrus Memory | No rule history, no record of breaks vs keeps, no "this rule has cost you X" | yes |

### Where memory visibly changes the product
Each break or keep is remembered with its outcome. After enough history the
app **escalates**: a rule you break often and that costs you gets a harder
warning or a cooldown. Rules you keep and that pay off stop nagging.

### Boundary
AI proposes: rule translation, the weekly reflection text.
Code decides: trade classification, rule verdicts, counterfactual numbers.
The model never: computes P&L, classifies a trade, or edits a rule without confirmation.

### What we deliberately do not claim
Not trading advice, not a prediction of returns. Counterfactuals are labelled.

### Risks
- **Data:** address history is ~30–90 days on GraphQL. That's fine for a recent-trades product, but say so.
- **Pricing:** OHLCV is one call per candle at 50 credits; pricing many trades eats credits. Only SUI and major tokens are priced; others are `UNPRICED`.
- **Demo:** needs *your* real trading history, or a fresh wallet doing small real swaps this week. A seeded history must be labelled.
- **Track fit:** Track 1 is about predictions, odds and credibility. This is closer to behavioural finance, so we'd need to argue the fit.

### Demo feasibility
Medium. Real swaps with small amounts are doable; showing an "escalation"
honestly needs several rule breaks over days.

**Score: good idea, medium-high data risk, weaker track fit.**

---

## 3. Crypto tax classifier ("Ask once")

**Track:** 3 Consumer Finance.

### Hook
"Tell it once that this is your other wallet. It never asks again."

### Who, the job, how they cope today, where it fails
Anyone who owes tax on crypto. Today they export CSVs into a tax tool, then
re-label the same transfers ("that's my own wallet", "that was a gift") every
year, and the tool still guesses wrong.

### Hard core
1. **Cost-basis engine** (FIFO / HIFO / specific-ID), lot by lot, checked against a brute-force oracle on small histories.
2. **Classification with memory:** each transfer is `SELF | GIFT | INCOME | SWAP | PURCHASE | UNKNOWN`. A classification you made once applies to matching future transfers (same counterparty and pattern) only when exactly one remembered rule matches.
3. `UNKNOWN` cost basis is never treated as zero.

### Thin-wrapper test
Passes: the engine and the matching are code. The model only suggests a
class for new transfers, and the user confirms it.

### Sponsor deletion test
| Sponsor | Removed → what breaks | On critical path? |
|---|---|---|
| Tatum Sui RPC + OHLCV | no history, no prices | yes |
| Walrus Memory | no remembered classifications → asks every time | yes |

### Fatal risk: data
- **A tax year needs 12+ months of history.** Sui address history is typically 30–90 days on GraphQL. Older transactions can only be found if you already have their digests.
- Pricing every acquisition and disposal: one OHLCV call (50 credits) per event; tokens outside Tatum's list are unpriced.
- Tax rules differ by country. A real product needs per-jurisdiction rules; a hackathon version must say "illustrative, not tax advice" everywhere.

### What we deliberately do not claim
Not tax advice; no jurisdiction compliance; not a full-year report unless the data range covers it.

### Demo feasibility
Low-medium. An honest full-year demo isn't possible from chain data alone in
this window. A "last 90 days" version undercuts the hook.

**Score: great hook, best hard core, but the data limit hits the core promise. Not recommended for this event.**

---

## 4. Ajo Keeper (rotating savings circle)

**Track:** 3 Consumer Finance. (Full check from the first pass, kept here.)

You asked for no country-specific ideas. The global version of this is the
**rotating savings and credit association (ROSCA)**: ajo, tanda, chit fund,
hui, tontine, chama. Pitch it under that name, with ajo as one example.

### Hook
"Run your savings circle without a treasurer who can disappear. The circle remembers who pays on time, and the payout order adapts."

### Hard core
Contribution reconciliation (exactly one member + cycle per transfer), a
payout-order engine with an agreed fairness rule (brute-force oracle for small
circles), and handling of missed payments.

### Sponsor deletion test
Tatum is the payment detector; Walrus Memory is the reliability record that
reorders payouts. Both on the critical path.

### Risks
- Needs **2–3 real people** paying small amounts for an honest demo.
- Overlap with **Kitty** (group pot via allowances). The difference is rotation and per-member reliability.
- Real money custody questions if the app holds the pot; simplest honest version: the app only *tracks and orders*, members pay each other directly.

### Demo feasibility
Medium. Real people, but only recent history needed (no retention problem).

**Score: strong story, medium build risk, people-dependent demo.**

---

## Comparison

| | 1. Fake-alert checker | 2. Precommit | 3. Tax classifier | 4. ROSCA / Ajo Keeper |
|---|---|---|---|---|
| Real pain, global | yes (on-chain slice) | yes | yes | yes |
| Hook clarity | very high | high | very high | high |
| Hard core | verdict engine, exactly-one matching | trade parsing + rule engine | cost-basis engine (best) | reconciliation + ordering |
| Memory visibly changes product | policy tier per buyer, scam patterns | escalation of broken rules | never asks twice | payout order |
| Data risk | **low** (recent + by digest) | medium-high (90-day window, pricing credits) | **fatal** (needs 12+ months) | low |
| Demo solo in 11 days | **yes** | partly (needs real trades) | no (honest full year impossible) | no (needs people) |
| Field overlap | Veyra/SpendMemory (opposite direction) | Walkback/Veto (different target) | none | Kitty (different mechanism) |
| Track fit | 2 or 3, clean | 1, arguable | 3, clean | 3, clean |

## Verdict

1. **Fake-alert checker: GO (recommended).** Lowest data risk, demo you can run alone, hard core that matches the code bar, and memory that changes behaviour in a way judges can see in 10 seconds. Condition: scope to on-chain stablecoin payments and say bank transfers are out.
2. **ROSCA / Ajo Keeper: GO if you can get 2–3 people** to run a real circle with small amounts in the next week.
3. **Precommit: CHANGE.** Only if you already trade on Sui and have recent history; otherwise the honest demo is thin.
4. **Tax classifier: DROP for this event.** The 30–90 day history window breaks the "tax year" promise. Good idea for a later grant or longer build.

Next once you confirm: spike S1, S2, S6, S7 with your keys, then FAILURE_MODES.md and the PRD for the chosen idea.
