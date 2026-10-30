# LANDSCAPE

Researched: 2026-10-30
Method: web search for the event name + cloned 12 public entrant repos (READMEs,
docs, commit dates). Entrants still building; this is a snapshot.

## House style at this event

The strong entries share one shape:
- **AI proposes, deterministic code decides.** The model never sets a verdict.
- **Chain as referee:** a claim (a pick, a promise, a payment, an agent's answer) gets checked against Sui mainnet through Tatum.
- **Memory that changes a later decision**, shown as a before/after: "lesson recalled → policy enforced".
- **Honesty labels everywhere:** `UNKNOWN` instead of guesses, "seed" data labelled, "not proven" tables.
- **Money on testnet, memory on mainnet** for the Move-heavy entries.

Match the style, then go deeper. Every serious entrant already does
"verify, don't trust", so it no longer stands out on its own.

## Neighbours

| Project | Track | What it does | Commits / dates (shallow clone: counts are approximate) | Our positioning line | Judge Q&A answer |
|---|---|---|---|---|---|
| [Anchor](https://github.com/angelraph/anchor) | 2 | Telegram accountability bot; money promises judged from Sui via Tatum; x402 stakes in a Move escrow; MCP; NGN pricing | 53, from Oct 7 (prior work, 3rd in Session 8) | The most complete entrant. Don't compete on promises/habits. | — |
| [RecallIQ](https://github.com/Olalekan2345/recalliq) | 2 | Sui investigation agent; claims re-checked on chain; lessons become enforced policies; x402 paid tool | 9, Oct 22–27 | Agent-reliability tooling for crypto analysts | — |
| [AFTERMATH](https://github.com/itzebe/aftermath) | 2 | Failure-prevention engine: incident → safeguard rule → memory → applied later; 88 mainnet writes | 44, Oct 27–29 | Meta-tooling for agents | — |
| [RECALLOS](https://github.com/zcsaqueeb/recallos-ai) | 2 | Personal decision agent that learns from outcomes | 2, Oct 27 | Generic; thin public history | — |
| [RecallDesk](https://github.com/Bortlesboat/recalldesk) | 2 | Support triage with reviewed corrections and revocation | 5, Oct 20; **already submitted** | Small and early | — |
| [VaultPath](https://github.com/Chima30/vaultpath) | 2 | Blockchain investigation workspace | 4, Oct 29 | Early; Tatum not yet verified live | — |
| [Walkback](https://github.com/joyboy-sats/walkback) | 1 | Scores X market calls against Tatum candles + Sui; demotes wrong sources | 29, Oct 20–26 | Judges *other people's* calls | — |
| [Veto](https://github.com/SammyCodes1/Veto) | 1 | Pick logger: bookmaker vs Polymarket; bad closing-line record disables logging | 6, Oct 27 | Pick journal | — |
| [Receipts](https://github.com/UyLeQuoc/total-recall-receipts) | 1 | Group pick'em, picks Merkle-anchored on Sui, scored vs books/Polymarket/Kalshi | 4, Oct 25; **entry undecided** (ADR-0060) | Group game | — |
| [SpendMemory](https://github.com/0xNexuz/spendmemory) | 3 | Payment review: checks wallet via Tatum, recalls past decisions per merchant | 36, Oct 28–29 | Review screen, never pays | — |
| [Veyra](https://github.com/0xaje/Veyra) | 3 | Recipient-address check before sending, remembered evidence | 30, Oct 24–27 | Address safety | — |
| [Kitty](https://github.com/UyLeQuoc/total-recall-kitty) | 3 | Group pot pulled via Sui app-bound allowances after payday; spend by vote | 7, Oct 25; **entry undecided** | Closest to a savings circle, but a shared pot, not a rotation | — |

Same author (UyLeQuoc / "Remora" monorepo) is behind Receipts, Kitty and a
Track 2 entry; the rules allow one submission per person, so at most one of
those enters per person.

## Clusters (where the field is crowded)
1. **"Verify the agent / learn from mistakes"**: RecallIQ, AFTERMATH, RECALLOS, VaultPath. Crowded; avoid.
2. **"Check before you send money"**: SpendMemory, Veyra. Crowded in Track 3.
3. **"Who was right" scoring**: Walkback, Veto, Receipts. They score *sources or groups*.

## Gaps (moments nobody covers yet)
- **Track 3 with the chain truly invisible for non-crypto users.** Everyone asks for wallets, addresses and signatures up front.
- **A local, everyday money ritual.** Nobody has built for rotating savings (ajo / esusu / chama / tontine), which many people already run in WhatsApp groups (size of user base unverified: find a source before quoting a number).
- **Calibrating *yourself*.** Track 1 entries score sources and groups; none tells *you* how over- or under-confident you are, by topic, and corrects your next number.
- **The Tatum AI Builder prize ($500).** AFTERMATH and RecallIQ both say they skipped it. It needs an app "built primarily with ai.tatum.io", which rules out most custom stacks, so few people are competing for it.
- **The step others skip:** a member who *misses* a payment, a revoked memory, a dispute.

## Past events and winners (calibration)

| Event | When | Rubric | What placed |
|---|---|---|---|
| **Tatum x Walrus hackathon** ([page](https://tatum.io/tatum-x-walrus-hackathon)) | May 23 – Jun 6, 2026; $2,000 | **Identical: 30/30/20/20** + social bonus | Winners announced on Discord/X only; not public on the web. **Ask in Tatum Discord #hackathon**: the best calibration source we don't yet have. |
| Walrus Session 8 "Chatbots That Remember" ([rules](https://thewalrussessions.wal.app/chatbots/index.html)) | Sep 18 – Oct 9, 2026; $2,500 WAL | "Does it actually remember?", before/after, build quality, article | Full list not public. **Anchor** reports 3rd place (self-reported in its README). It's now in Total Recall Track 2. |
| Walrus Haulout ([winners](https://walrus.xyz/blog/haulout-hackathon-winners-2025/)) | Nov 2025; hundreds of entries, 27 countries | innovation, technical execution, potential | 1st places: **Spectra** (private moderation), **Storewave** (storage marketplace), **Wit With Withub** (encrypted code collab), **perma.ws** (verifiable web archives). Also **Chronos** (dead-man's switch), **Delphi** (prediction market), **KrillTube** (pay-per-watch). |
| Tatum MCP hackathon ([page](https://tatum.io/mcp-hackathon)) | weekend event | innovation 40%, tech + MCP 40%, presentation 20% | results on Discord only |

What the winners have in common:
- **A product a normal person gets in one sentence** (pay per minute watched, a dead-man's switch, verified archives), not infrastructure-speak.
- **The sponsor tech is the reason it works** (Walrus as the archive, Seal as the privacy), not a logging sidecar.
- **Anchor's 3rd** came from a *real channel real people use* (Telegram), a live bot, and visible "memory changed the reply" moments.

## Prepared judge questions
- Q: How is this different from SpendMemory / Kitty / Anchor? A: written per idea once chosen.
- Q: What happens if Walrus Memory is deleted? A: must answer "the product stops working", per idea.
- Q: Is any data seeded or simulated? A: labelled, per the build contract.
