# STAKEHOLDERS and past major winners

Researched: 2026-10-30
Purpose: pick an idea the sponsors and judges already want, calibrated against
what won at the major Sui and Walrus hackathons, not just the small Walrus
Sessions.

## 1. Past major hackathons: what won

### Sui Overflow 2026 ([winners](https://www.sui.io/blog/sui-overflow-2026-winners))
Sui's flagship hackathon. **The Walrus track was the most-entered track.**

| Track | Winners (1st → 4th) |
|---|---|
| Walrus | **Kraterion** (S3-compatible storage you own + agents + tamper-evident agent runs) · **Deploy by Suize** (agent publishes a Walrus site in one call, content checked against on-chain hashes) · **Carry** (proof-carrying agent memory: access checked *before* the model sees memory, an "Answer Receipt" for every answer) · **Praxis** (dry-runs, risk-scores and gates agent wallet spends, logging every decision to Walrus) |
| Agentic Web | Sup Wallet (agent trades and pays within limits you set once) · Sprout (plain English → one sponsored transaction) · Rill (Sui protocols as machine-callable apps) · Aether (agents pay and dispatch hardware, with proofs) |
| DeFi & Payments | Quay (web2 merchants accept USDsui through their existing QR codes, **live in Singapore**) · Talise (gasless dollar account, Google sign-in, send to names) · Brisk (tap-to-pay USDC terminal) · Splash (B2B cross-border invoices → stablecoin settlement → audit) |
| DeepBook | PIPS · Yosuku · Skew · Flicky. **DeepBook Predict** was the base layer for 16 submissions. |
| University | includes **ContextMeM** (scraped web as recallable agent memory on Walrus), PayPerCard, Paystreamer, TALOS |

### Sui Overflow 2025 ([winners](https://www.sui.io/blog/2025-sui-overflow-hackathon-winners.md))
- Programmable Storage (Walrus) winners: SuiSign (document signing), WalGraph (graph database), SuiMail (pay-to-send email), Walpress (site builder).
- AI winners: Suithetic (verifiable synthetic data), OpenGraph (ML models on Walrus).
- Explorations included Skepsis (rewards accurate forecasting) and PredictPlay.

### Sui Overflow 2024 ([winners](https://www.sui.io/blog/2024-sui-overflow-hackathon-winners.md))
No Walrus track yet. First places include Pandora Finance (prediction market), Kraken (multisig suite) and PinataBot (Telegram trading via zkLogin).

### Walrus Haulout, Nov 2025 ([winners](https://walrus.xyz/blog/haulout-hackathon-winners-2025/))
Spectra, Storewave, Wit With Withub, perma.ws (1st places); Chronos, Delphi, KrillTube, zkDungeon and others.

### Walrus "Breaking the Ice" (devnet, 2024)
Its winners list wasn't published on the event site ([page](https://info.breakingtheice.sui.io/)).

### Pattern across the major winners
1. **Walrus judges reward agent infrastructure with proof.** 3 of 4 Overflow 2026 Walrus winners are about *agents*, and two of them about *verifiability*: Carry's receipts, Praxis's gated spends logged to Walrus.
2. **Payments winners are real consumer flows**, often live with real merchants (Quay), with the chain hidden (Google sign-in, send to names).
3. **Winners pick one primitive and go deep:** a receipt, a gate, a QR code. Never a general platform.
4. Walrus then **writes blog posts about the winners** (Carry, Kraterion, Suize). Building for Walrus means building something Walrus wants to showcase.

### What separates 1st from 2nd from 3rd (inferred; organisers publish no per-place reasoning)
Evidence: Walrus deep-dives on [Kraterion](https://walrus.xyz/blog/kraterion-s3-storage-you-own-built-on-walrus-verifiable-agent-runtime/) (1st), [Suize](https://walrus.xyz/blog/suize-agent-ships-walrus-website/) (2nd), [Carry](https://walrus.xyz/blog/carry-verifiable-agent-answers-built-on-walrus-memory/) (3rd); Overflow 2026 payments order; Haulout 1st places.
- **1st:** uses the *most* of the sponsor's stack, used deeply. Kraterion uses Walrus StoragePool and PooledBlob, Seal, Move and Walrus Memory. It also replaces a product people already pay for (S3), and fixes a real economic problem: per-blob cost made small files expensive. Quay (payments 1st) is live with real merchants.
- **2nd:** one complete end-to-end flow with a genuinely hard edge solved. Suize: "design idempotency before you accept money" (payment settles before storage does).
- **3rd:** a sharp, well-proven concept with narrower scope. Carry: receipts for agent memory.
- Live users help but aren't required: Kraterion won while still on testnet. Depth and correctness count for more than scale.

## 2. What each stakeholder has said it wants

### Walrus Foundation
Sources: [blog index](https://walrus.xyz/blog/) (19 latest posts), [Agentic Memory Debt](https://walrus.xyz/blog/what-is-agentic-memory-debt-and-why-your-agents-keep-accumulating-it-verifiable-portable/), [How agents learn](https://walrus.xyz/blog/how-do-ai-agents-learn-from-past-interactions/), [Carry feature](https://walrus.xyz/blog/carry-verifiable-agent-answers-built-on-walrus-memory/), [Walrus Console](https://walrus.xyz/blog/introducing-walrus-console/), [RFP program](https://walrus.xyz/rfp/)

- **Dominant theme: agent memory.** 8 of the last 19 posts are about agent memory.
- The three properties Walrus says production memory needs: **persistence, portability, and an independently verifiable audit trail**, plus access control and shared memory between agents.
- **Problems Walrus itself calls unsolved** ("How do AI agents learn", Aug 2026). This is the best target list we have:
  - extraction turning an **inference into a fact**
  - consolidation **overwriting valid exceptions**
  - **memory poisoning:** poisoning <0.1% of records triggered attacks ≥80% of the time (AgentPoison, cited)
  - **over-retention** causing tunnel vision
  - retrieval missing the right record
  - **cross-tool portability** is still manual
- Patterns Walrus recommends: structured records with source and evidence type, **separating what a user stated from what a model inferred**, scoped memory, versioned facts, **verifying before acting**.
- **Walrus Console (7 Oct 2026)** already auto-renews storage and shows when Walrus Memory memories expire. **This undercuts our storage expiry watchdog idea: Walrus is building it themselves.**
- RFP program: grants need a Walrus team sponsor; judged on technical strength, creativity, ecosystem engagement and commitment.

### Sui / Mysten Labs
Sources: [Sui Basecamp 2026](https://www.sui.io/blog/the-agentic-economy-takes-sui-basecamp-2026-singapore), [Overflow 2026](https://www.sui.io/blog/sui-overflow-2026-winners), [DeepBook Predict](https://www.sui.io/blog/introducing-deepbook-predict)
- Headline: **"the agentic economy"**, where agents "transact within explicit limits" and "every action produces a verifiable receipt onchain".
- Stablecoins (USDsui) and consumer payments with the chain hidden.
- **DeepBook Predict** (prediction markets, including one-minute markets) is a flagship push.

### Tatum
Sources: [Blockchain APIs for AI agents (Jun 2026)](https://tatum.io/blog/blockchain-ai-agents), [Prediction API (May 2026)](https://tatum.io/blog/prediction-market), [Tatum × Walrus 11TB data](https://walrus.xyz/blog/tatum-integrates-walrus-to-accelerate-blockchain-data-access-for-developers-and-ai-agents/)
- Positioning: **the data layer for AI agents.** "The limiting factor is not intelligence", it's data access.
- Agent use cases Tatum names: monitoring wallets, **reacting to live events such as user deposits**, long-running workflows with persistent context, **shared context across multi-agent systems**, **verifiable data integrity for critical operations**.
- Products to show off: Data APIs, **Prediction API** (Polymarket + Kalshi, normalised, filter by active/closed/resolved, wallet win-rate and ROI), MCP server, Notifications (webhooks), Storage API (Walrus), AI Builder.

## 3. What this means for our shortlist

| Idea | Walrus signal | Sui signal | Tatum signal | Field gap | New verdict |
|---|---|---|---|---|---|
| **Fake-alert checker**, upgraded to *verified memory*: every memory carries chain evidence; "stated by buyer" vs "verified on chain" kept apart; buyers can't plant favourable memories | **direct hit**: verify before acting, stated vs inferred, poisoning | stablecoin payments, verifiable receipts | **direct hit**: "reacting to user deposits", data integrity, Notifications | no entrant verifies incoming money | **GO, top pick** |
| **Calibrate** on Polymarket/Kalshi via Tatum + Sui-anchored forecasts | learning from past interactions, versioned facts | prediction markets are a flagship (DeepBook Predict) | **direct hit**: showcases the Prediction API (resolved-market filter makes an honest backfill possible) | Track 1 entries score sources, not the user | **GO, strong second** (upgraded) |
| Storage expiry watchdog | wanted, **but Walrus Console now does it** | — | — | Walrus's own product covers it | **DOWNGRADED: don't build** |
| ROSCA / Ajo Keeper | shared memory between members | consumer payments, chain hidden | deposits | none in the field | GO if people available |
| Agent spending gate | — | **direct hit** (explicit limits, receipts) | — | **Praxis and Sup Wallet already won Overflow with this** | crowded at the top level: avoid |

## 4. The pitch that hits all three stakeholders

**"Paid?": a payment-verification agent whose memory can't be fooled.**
- *For Sui:* stablecoin commerce, verifiable receipts, the chain hidden from the seller.
- *For Tatum:* reacting to user deposits through Tatum Sui RPC + Notifications; data integrity for a critical decision.
- *For Walrus:* it addresses the unsolved problems Walrus names:
  - every memory is a structured record with source + evidence type
  - **"buyer said" never becomes "verified" without a chain digest**
  - poisoning attempts (fake digests, planted "trusted buyer" claims) are quarantined, and a test suite attacks it the way AgentPoison does
  - each verdict ships with a receipt, like Carry's, that resolves to Walrus blobs
- *For the judges:* a 10-second live moment: paste a fake, watch it fail with a receipt.
