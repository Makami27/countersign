# IDEA_CHECK: final two (built from the six winning traits)

Date: 2026-10-30
Inputs: `STAKEHOLDERS.md` (six traits, sponsor signals), `EVENT.md` (rubric),
`LANDSCAPE.md` (field), `anti-patterns.md`.

## New facts found for this check

| Fact | Source | Affects |
|---|---|---|
| RedSentinel (Walrus Session 9, 5–20 Oct) was about **prompt injection, social engineering and jailbreaks against defenders guarding a secret**. Memory poisoning isn't mentioned; no payee or address defence seen. | [rules](https://thewalrussessions.wal.app/redsentinel/index.html), [UyLeQuoc write-up](https://dev.to/uylequoc/i-spent-a-week-breaking-ai-agents-for-wal-heres-how-you-join-walrus-session-9-4dp7) | Countersign: overlap **low** |
| Sui gRPC `SignatureVerificationService.VerifySignature` accepts **PersonalMessage** and TransactionData, with an optional `address` that must match the signer; zkLogin is verified against on-chain JWKs. Tatum's gateway lists this service. | [QuickNode reference](https://www.quicknode.com/docs/sui/sui-grpc/signature-verification/verify-signature), [Tatum RPC page](https://docs.tatum.io/reference/rpc-sui) | Countersign: payee-signed address changes are verifiable through Tatum (spike S10) |
| **Tatum Notifications do not support Sui.** | [Tatum supported chains](https://docs.tatum.io/reference/notifications-supported-chains) | Both: detect payments by polling GraphQL or via gRPC `SubscriptionService`, not webhooks |
| Stablecoin reconciliation is called "the real bottleneck" by vendors (Eco, Bitwave, Cryptoworth). No Sui-native tool found. | [Eco](https://eco.com/support/en/articles/14466065-stablecoin-settlement-reconciliation-in-2026-why-the-accounting-layer-is-the-real-bottleneck), [Cryptoworth](https://www.cryptoworth.com/blog/stablecoin-accounting-tools), [Bitwave](https://www.bitwave.io/blog/real-time-reconciliation-reporting-for-stablecoin-payouts-2025-guide) | Closebook: market real, gap real |
| Sui transfers carry **no memo field**. Matching a payment to a sale means amount + time + sender, and identical amounts (many $5 sales) are ambiguous. | Sui transaction model (unverified detail: confirm in spike) | Closebook: core matching risk |

---

## A. Countersign: payee memory an AI agent can't be talked out of

**Track:** 2 Smart Agents for Real Life ("expense watchdog", "workflow bots").

### Hook
"Your AI agent pays your bills. Someone just told it your landlord changed wallets. It won't believe them."

### Who, the job, how they cope today, where it fails
- **Who:** a person or small team that lets an AI agent pay recurring payees (rent, a freelancer, a supplier) in USDC on Sui.
- **How they cope today:** the agent's address book is just memory, and anything written into it is trusted.
- **Where it fails:** someone plants "the new address is 0x…" in an email, a chat or a web page the agent reads, and the next payment goes to the attacker. Princeton showed this works on real Web3 agents: even the strongest models followed poisoned memory more than half the time, and user confirmation barely helped because the agent still suggested the attacker's address ([Princeton 2025](https://blog.ai.princeton.edu/2025/09/09/when-your-ai-assistant-gets-gaslithow-real-ai-agents-with-fake-memories-shows-that-smart-assistants-can-go-dangerously-off-script/)). The human version of this fraud cost ~$2.8B in 2024 ([IC3 via Nacha](https://www.nacha.org/news/fbis-ic3-finds-almost-85-billion-lost-business-email-compromise-last-three-years)).

### Hard core
1. **Payee records that know where each fact came from:** every address version is tagged `VERIFIED`, `STATED` or `CONFLICT`, with its source and evidence. Only `VERIFIED` can be paid.
2. **An address change only takes effect through one of three verified paths:**
   - a PersonalMessage signed by the payee's current verified address, checked through Tatum `VerifySignature`
   - a test transfer round trip, detected on chain
   - out-of-band human confirmation, followed by a cooldown

   Each change moves through fixed states: `REQUESTED → PENDING_PROOF → VERIFIED | REJECTED | EXPIRED`, with no shortcut edge.
3. **Look-alike detection:** a new address sharing its prefix and suffix with a known payee gets `CONFLICT`, not "new payee".
4. **Spend gate:** reserve-then-settle, an amount cap per payee, `UNKNOWN` broadcast never retried, a receipt per payment.

### Thin-wrapper test
Delete the model and nothing that moves money changes. The model only reads
inbound messages and proposes structured requests ("change request for
Landlord, new address X"), which then go through the change process.

### Sponsor deletion test
| Sponsor | Removed → what breaks | On critical path? |
|---|---|---|
| Walrus Memory | no address book with versions and sources → nothing to protect, no history to compare a change against | yes |
| Tatum Sui RPC | no signature checks, no test transfers detected, no payments | yes |
| Sui | no on-chain receipts for changes and payments | yes |

### Boundary
- **AI proposes:** extracted change requests, payment drafts, plain-language explanations.
- **Code decides:** whether a change is verified, whether a payee is payable, the amount and the cap.
- **The model never:** marks an address verified, edits a payee record directly, chooses a recipient address, or lowers a cap.

### The loop
inbound message → proposed change → `PENDING_PROOF` → proof checked on chain → `VERIFIED` (new version stored, old kept) or `REJECTED` (remembered as an attack pattern) → **next payment uses the verified version, and a repeat of the same attack is refused instantly, citing the earlier record.**
The step others skip: the *refusal*, kept on record with a receipt.

### What we deliberately do not claim
- Not protection against a compromised payee key (a signature from a stolen key passes; the threat model says so).
- Not protection against general prompt injection beyond the payee path.
- Not custody: the agent's wallet is the user's, with caps.

### Proof plan (the trait judges reward)
- **Live attack lab:** a public page where a judge sends the agent a poisoned message and watches it refuse with a receipt.
- **Measured result:** replay memory-injection cases modelled on CrAIBench's payment tasks against the same agent with and without Countersign. The metric is chosen in advance (attacker-address payments per 100 attempts) and the result is reported whatever it is.
- Receipts resolve to Walrus blobs and Sui transactions.

### Risks
- **It's a security product, so the story must stay human.** Open the video on "my rent almost went to a scammer".
- **The attack lab can't hold real money.** Agent wallet caps of a few cents, testnet for the lab, mainnet for the real payments, all labelled.
- **Tatum `VerifySignature` on PersonalMessage needs a spike (S10).** Fallback: verify locally with the Sui SDK and say so (but then it isn't "via Tatum").
- No Tatum webhooks for Sui, so incoming test transfers are detected by polling.

### Rubric → proof map
| Criterion | Answer | Proof a judge can open |
|---|---|---|
| Walrus + Tatum use 30% | memory is the protected asset; Tatum verifies and pays | deletion test, receipts linking to blobs and transactions |
| Technical quality 30% | fixed change states, matching to exactly one payee, reserve-then-settle, attack and property tests | test suite, attack lab |
| Creativity 20% | known research attack → first product defence for on-chain payees | Princeton citation, landscape gap |
| Presentation 20% | "try to scam my agent" in the first 20 seconds | 60-second judge path |

### Six-trait score
| Trait | Score |
|---|---|
| Sponsor tech is the reason it works, used deeply | ●●●●○ (Walrus Memory, Tatum gRPC + GraphQL, Sui receipts; Seal optional) |
| Replaces something people pay for | ●●●●○ (Eftsure, Trustpair) |
| One hard problem solved properly | ●●●●● |
| One job, finished | ●●●●● |
| Provable claims | ●●●●● (attack lab + measured block rate) |
| Real usage | ●●●○○ (your own real payees, small amounts) |

**Verdict: GO.**

---

## B. Closebook: month-end books for businesses paid in stablecoins

**Track:** 3 Consumer Finance (or 2).

### Hook
"Your shop takes USDC. Your accountant still wants a spreadsheet. Closebook closes your month and remembers every answer you gave it."

### Who, the job, how they cope today, where it fails
- **Who:** a small merchant or freelancer paid in USDC or USDsui on Sui (the segment Quay, Talise and Brisk target).
- **How they cope today:** exporting an explorer CSV and labelling every line by hand every month, or paying for enterprise tools (Bitwave, Cryptio) that are priced for enterprises.
- **Where it fails:** the same supplier gets relabelled every month, and nobody can prove a closed month wasn't edited later.

### Hard core
1. **Matching each payment to exactly one record:** each Sui transfer matches exactly one sale, invoice or bill, or goes to `NEEDS_DECISION`. **The catch: Sui transfers have no memo,** so identical amounts are ambiguous. The fix is payment requests with unique amounts (e.g. 5.0137 USDC) or a payment-request ID, generated by Closebook. That's a product decision, and it narrows the product to sales it can see.
2. **Filing rules with versions and sources:** stated by the user vs suggested by the AI and confirmed, with a new version on every change. Two rules matching one payment block it from filing itself.
3. **Ledger rules:** debits and credits must balance, closed months can only be corrected with adjustment entries, `UNKNOWN` is never booked as zero, and SUI is valued via Tatum price data (stablecoins at par, labelled).
4. **Closing a month:** the report goes to Walrus and its fingerprint is anchored on Sui. Anyone can recompute it.

### Thin-wrapper test
Passes. The model only suggests a category for new counterparties.

### Sponsor deletion test
| Sponsor | Removed → what breaks | On critical path? |
|---|---|---|
| Tatum Sui RPC + price data | no ledger, no valuation | yes |
| Walrus Memory | no remembered rules → asks everything every month | yes |
| Walrus storage + Sui | no closed, provable report | yes |

### Boundary
- **AI proposes:** category suggestions, the month summary.
- **Code decides:** matching, rules, balances, the close.
- **The model never:** posts an entry, changes a closed month, or values an asset.

### What we deliberately do not claim
Not tax or accounting advice; not a filing tool; no history before Sui's
~30–90 day window; no off-chain sales unless the merchant imports them.

### Risks
- **Data to demo:** needs a wallet with real business-like activity across two periods before 10 Nov. October can be closed for real only if the wallet already had October activity. Otherwise: two short periods, labelled.
- **The memo gap** (above) makes matching hard or forces a payment-request feature, which grows scope.
- **Demo drama is lower:** "month two asks 2 questions, not 14" is clear but quiet.
- **Real usage:** you'd need a real merchant's data to get past "illustrative".

### Six-trait score
| Trait | Score |
|---|---|
| Sponsor tech is the reason it works, used deeply | ●●●●○ |
| Replaces something people pay for | ●●●●● (Bitwave, Cryptio, bookkeepers) |
| One hard problem solved properly | ●●●○○ (memo gap makes "properly" expensive) |
| One job, finished | ●●●●○ |
| Provable claims | ●●●●○ (recomputable close) |
| Real usage | ●●○○○ (needs a real merchant) |

**Verdict: CHANGE.** Strong market, but the memo gap and the two-period demo
make an honest, finished build in 11 days risky. It's a good grant or
post-hackathon project.

---

## Head to head

| | Countersign | Closebook |
|---|---|---|
| Six-trait total | **27 / 30** | 22 / 30 |
| Biggest strength | live, attackable proof; answers Walrus's own unsolved problem | replaces a paid product; Sui merchant push |
| Biggest risk | security framing must stay human | no memo field; two periods before the deadline |
| Solo demo in 11 days | yes | partly |
| Best Walrus Memory prize | strong (poisoning defence) | good (ask-once rules) |
| Overlap | low (RedSentinel = prompt attacks on secrets; Carry = access, not truth; Praxis = spend risk, not where an address came from) | none found on Sui |

## Verdict
**Countersign: GO.** Closebook: park it.

Next: spikes S1, S2, S6, S10 (Tatum `VerifySignature` on PersonalMessage),
then `FAILURE_MODES.md` and `PRD.md` for Countersign.

---

## C. Forward: backtests that have to survive the future

**Track:** 1 Markets & Sports Prediction (smallest visible field: Walkback, Veto, Receipts).

### New facts for this check
| Fact | Source |
|---|---|
| Tatum free plan: **100,000 credits**, 3 requests/s, 2 API keys (renewal period not stated). OHLCV costs **50 credits per candle**, so the free plan buys about **2,000 candles** in total. | [Tatum plans](https://docs.tatum.io/docs/plans-limits), [OHLCV ref](https://docs.tatum.io/reference/getsymbolohlcv.md) |
| Track-record verification is a paid, trusted category: Myfxbook "verified track record" is the forex industry's standard trust signal for signal sellers, and fake records are a known scam. | [Myfxbook help](https://www.myfxbook.com/help/verification) (couldn't load; secondary: [Forex Peace Army on signal scams](https://www.forexpeacearmy.com/forex-books/202/common-forex-signal-scams), [babypips on fake Myfxbook accounts](https://forums.babypips.com/t/ways-to-recognize-fake-and-real-accounts-on-myfxbook/194062)) |
| Backtest overfitting through hidden trial counts is well studied; the deflated Sharpe ratio corrects for the number of variants tried. | [López de Prado review](https://daru.finance/research-review/lopez-de-prado/backtest-overfitting) |
| Tatum's 11TB Walrus datasets (Ethereum, BTC, BSC) have **no public format or catalog documented**. | [Walrus × Tatum post](https://walrus.xyz/blog/tatum-integrates-walrus-to-accelerate-blockchain-data-access-for-developers-and-ai-agents/) |

### Hook
"Anyone can sell a backtest. Forward makes it prove itself on data it hasn't seen yet, and remembers who keeps lying."

### Who, the job, how they cope today, where it fails
- **Who:** buyers of crypto trading signals or strategies, and honest strategy authors who want to prove they're not faking.
- **How they cope today:** screenshots of backtests, or broker-linked verification like Myfxbook (forex only, live accounts only; it says nothing about how a backtest was made).
- **Where it fails:** an author tries 500 variants, publishes the best, and the edge disappears live. Buyers can't see the 499.

### Hard core
1. **Commit before the future:** the strategy (in a small rules language), its settings, the declared number of variants and the forward-window start are hashed and committed in a Sui object (Move + `Clock`) through Tatum. Nothing can change afterwards; a new version is a new commitment.
2. **Reproducible past:** the backtest dataset is fetched once through Tatum, frozen on Walrus, and identified by its blob ID. The engine is fixed and repeatable, so anyone gets the same numbers, checked by an independent rerun.
3. **No lookahead:** the engine can only read candles that closed *before* each decision time. A test fails if anyone breaks this.
4. **Honest scoring:** a deflated Sharpe ratio using the declared variant count. Results are a closed set: `HOLDING | DECAYING | FAILED | INSUFFICIENT_DATA`. A small sample is never scored.
5. **Forward runner:** new candles arrive via Tatum and live results are compared with the committed backtest. A gap in the price data is `UNKNOWN`, never filled in.

### Thin-wrapper test
Passes. No model is needed at all. An optional model turns a plain-English
strategy into the rules language, and the author confirms before committing.

### Sponsor deletion test
| Sponsor | Removed → what breaks | On critical path? |
|---|---|---|
| Tatum (OHLCV + Sui RPC) | no prices, no commitments | yes |
| Walrus storage | no frozen data → backtests can't be reproduced | yes |
| Walrus Memory | no author track records → buyers can't see "this author's strategies keep fading" | yes |
| Sui (Move object + Clock) | no time-stamped commitments → authors could backdate | yes |

### Where memory visibly changes the product
- Each author's record of strategies, promises and outcomes is kept as versioned memory, with **declared** facts (variant count, claims) kept apart from **measured** results.
- When an author commits a new strategy, Forward recalls their history and puts it on the strategy page before anyone buys or follows it.
- Authors who under-declare variants show a pattern over time (a big drop from backtest to live results, again and again). Memory surfaces it as **measured, not alleged**.

### Boundary
- **AI proposes:** turning a plain-English strategy into rules.
- **Code decides:** every number, every verdict.
- **The model never:** computes performance, edits a commitment, or writes an author's record.

### The loop
author writes rules → commits on Sui → backtest frozen on Walrus → forward window runs on new prices → verdict → author record updated in memory → **the author's next strategy opens with that record attached.**
The step others skip: the *failed* strategy, kept on record forever.

### What we deliberately do not claim
- Not investment advice, and no trade execution.
- Declared variant counts are self-reported. Forward can't see variants an author never declared. It only measures the result: a large backtest-to-live drop.
- A 10-day forward window proves little statistically; the UI says so.

### Risks
- **The forward window before 10 Nov is about 8–10 days.** Use hourly candles; most verdicts will honestly be `INSUFFICIENT_DATA` at submission. That's truthful, but the demo needs at least one clear `DECAYING` case, which only real data can supply. **Biggest risk.**
- **Credit budget:** about 2,000 candles on the free plan. Pick one or two assets, fetch once and freeze; hourly SUI for 30 days back plus 10 forward ≈ 960 candles ≈ 48k credits. It fits, but there's little room for mistakes.
- **Real usage:** needs outside authors. Without them: your own strategies plus clearly labelled demo strategies, one of them deliberately overfit.
- **Track fit:** the brief is about odds, picks and credibility scores. Strategies are "markets", so it fits, but it isn't sports.
- **Walkback overlap:** it scores *calls* by people on X. Forward scores *committed strategies* and their fade. Different, but both are "credibility", so judges need a clear line.
- No AI is required. That's good for honesty, but this is an AI-memory event. Walrus Memory carries the author records, which keeps it on theme.

### Rubric → proof map
| Criterion | Answer | Proof a judge can open |
|---|---|---|
| Walrus + Tatum use 30% | frozen datasets on Walrus, author memory, Tatum prices and commitments | blob IDs, Sui objects, rerun command |
| Technical quality 30% | repeatable engine, no-lookahead tests, independent rerun check, deflated Sharpe | test suite + `verify` script |
| Creativity 20% | commit-before-future for strategy claims | landscape gap |
| Presentation 20% | backtest vs live results on one chart | live page |

### Six-trait score
| Trait | Score |
|---|---|
| Sponsor tech is the reason it works, used deeply | ●●●●● (Tatum prices + RPC, Walrus storage, Walrus Memory, Sui Move) |
| Replaces something people pay for | ●●●○○ (Myfxbook-style verification; no direct crypto-backtest incumbent) |
| One hard problem solved properly | ●●●●● |
| One job, finished | ●●●●● |
| Provable claims | ●●●●● |
| Real usage | ●●○○○ |

**Total 25/30. Verdict: GO with conditions.** It's buildable and very
provable, but the short forward window means the headline result may honestly
be "not enough data yet" on submission day.

---

## Final head to head (all three)

| | Countersign | Forward | Closebook |
|---|---|---|---|
| Six-trait total | **27/30** | 25/30 | 22/30 |
| Track (field size) | 2 (crowded, but no one in this niche) | 1 (smallest) | 3 |
| Demo moment | judge tries to scam the agent live | backtest line vs live line | month two asks 2 questions |
| Works honestly by 10 Nov | yes | partly (short window) | partly |
| Best Walrus Memory prize fit | strongest (poisoning, stated vs verified) | good (author records) | good |
| Biggest risk | security framing | `INSUFFICIENT_DATA` on demo day | memo gap |
| Verdict | **GO (recommended)** | GO with conditions | park |
