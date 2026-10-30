# EVENT: Total Recall (Walrus x Tatum Memory Hackathon)

Researched: 2026-10-30
Sources:
- https://thewalrussessions.wal.app/tatum-total-recall/index.html (official rules page)
- https://recall-tatum-walrus.vercel.app (event + submission site)
- https://tatum.io/hackathon/total-recall (canonical page; renders by script, only metadata was readable)
- https://tatum.io/tatum-x-walrus-hackathon (the June 2026 predecessor, same rubric)
- Entrant worksheets that quote the page: itzebe/aftermath `docs/SUBMISSION.md`, Olalekan2345/recalliq `docs/HACKATHON.md`

## At a glance
| Item | Detail |
|---|---|
| Build window | 2026-10-20 → 2026-11-10 |
| Deadline (exact, with TZ) | **2026-11-10 17:00 UTC** (18:00 Lagos) |
| Judging | 11–16 Nov 2026, by a panel; decisions final |
| Winners | 17 Nov 2026 |
| Prizes | $4,500 total, paid in USDC; claim within 14 days with a test transaction |
| Field size | unknown; 13 public entrant repos found by 2026-10-30 (see LANDSCAPE.md) |

### Prize table
| Prize | Amount |
|---|---|
| Track 01 Markets & Sports Prediction | 1st $500 · 2nd $300 · 3rd $200 |
| Track 02 Smart Agents for Real Life | 1st $500 · 2nd $300 · 3rd $200 |
| Track 03 Consumer Finance Apps | 1st $500 · 2nd $300 · 3rd $200 |
| Best Walrus Memory | $500: "deepest learning loop, memories that visibly change the product" |
| Best Tatum AI Builder app | $500: best shippable product built *primarily* with ai.tatum.io |
| Third special prize | $500, **sources disagree** (see open questions) |

## Scoring
| Criterion | Weight | What "full marks" looks like | Our planned proof |
|---|---|---|---|
| Walrus + Tatum integration | 30% | Walrus Memory does real work (remove it and the product breaks); Tatum RPC or Data APIs on the critical path | deletion test in IDEA_CHECK; memory before/after in demo |
| Technical quality | 30% | Clean code **and a successful Tatum Sui RPC integration** (named explicitly) | code bar + live Tatum spike evidence |
| Creativity | 20% | Not a copy of the track brief ("entries should not copy the brief verbatim") | IDEA_CHECK hook + gap |
| Presentation | 20% | Clear docs and a working demo | README, 60-second judge path, 2–3 min video |
| Bonus | extra points | Post on X or LinkedIn; tagging @Tatum_io and @WalrusFoundation optional | launch post |

Heaviest items: integration and technical quality, tied at 30%. Together
that's 60% of the score for "uses the sponsors for real, and the code is good".
Fatal gate(s): no Walrus Memory writes on **Mainnet**, or fewer than **10
memories on Mainnet**, or no public repo / working demo / published blog.

## Eligibility gates (acceptance IDs)
| ID | Requirement | How we verify | Evidence file |
|---|---|---|---|
| A01 | Walrus Memory integrated, writing on Mainnet (`relayer.memory.walrus.xyz`) | live test: rememberAndWait returns a blob id, recall returns it | `evidence/a01-mainnet-write.json` |
| A02 | ≥ 10 memories stored on Mainnet, from real use (no filler) | script reads `listMemories`/`listNamespaces` count | `evidence/a02-memory-count.json` |
| A03 | Tatum RPC used for on-chain data where relevant | live spike + integration test against Tatum gateway | `evidence/a03-tatum-read.json` |
| A04 | Published blog post: what it does, how it uses Tatum + Walrus, **how it learned over time** | URL resolves publicly; section headings match | `evidence/a04-blog.md` |
| A05 | Working demo, reachable by judges | public URL health check | `evidence/a05-health.json` |
| A06 | Public GitHub repo | clean-clone gate passes | `evidence/a06-clean-clone.txt` |
| A07 | 2–3 minute demo video (form field) | duration check on the file | `evidence/a07-video.txt` |
| A08 | Form fields complete: email, Discord, LinkedIn, Tatum ID, SUI address, account ID, MEMWAL_AGENT_ID (delegate **public** key), description, video, repo, experience questions | pre-submit audit | — |
| A09 | Work completed or materially advanced during 20 Oct – 10 Nov | git history inside the window | `git log` |
| A10 | One submission per person | — | — |

## Entry type chosen and why
**Track 2, Smart Agents for Real Life** (Countersign, D1), also aiming at Best Walrus Memory. Visible competition per track as of
2026-10-30: Track 2 has the most entrants (6), Track 1 has 3, Track 3 has 3–4.
Track 3 is also the only brief that asks for the blockchain to "stay
invisible", which most crypto-native entrants do badly.

## Track briefs (paraphrased)
- **01 Markets & Sports Prediction:** compare bookmaker odds with on-chain sources, track who was right, store credibility scores. Examples: sports companion that learns your leagues, odds dashboards flagging disagreement, pick journals with post-game scorecards.
- **02 Smart Agents for Real Life:** agents that watch inboxes, expenses, habits or workflows, with memory that carries across tools and sessions. Examples: research agent with source trust scores, expense watchdog, workflow bots that learn escalation rules.
- **03 Consumer Finance Apps:** everyday money (shared budgets, spend tracking, savings goals, payments), blockchain invisible, memory keeps balances, habits, preferences. Examples: group spending / who owes what, subscription manager with learned limits, savings goals that adapt to real cash flow.

## Stack, hosting and "real work" rules
- Walrus Memory on Mainnet is mandatory. The managed relayer pays WAL and gas for writes, so mainnet memory costs nothing ([public-relayer docs](https://github.com/MystenLabs/MemWal/blob/main/docs/relayer/public-relayer.md)).
- Tatum RPC "where relevant", but the technical-quality line names "successful Tatum Sui RPC integration", so treat it as required in practice.
- Sui **money** can be on testnet: strong entrants (Kitty, Receipts) run Move and money on testnet with memory on mainnet. Unverified whether judges mark that down.
- Hosting: no domain rule found. Judges must be able to open the demo.

## What judges read, in order (inferred, not stated)
The form collects: description → demo video → repo → (blog linked from README).
Plan for a judge who watches the video first, then opens the live demo, then
skims the README.

## Submission fields → where our answer lives
| Field | Where |
|---|---|
| Email, Discord, LinkedIn | you |
| Tatum ID | Tatum dashboard account ID |
| SUI address, account ID | your wallet + MemWal account |
| MEMWAL_AGENT_ID | public key under "Delegate keys" at memory.walrus.xyz/dashboard |
| Description | submission doc (phase 9) |
| Demo video (2–3 min) | PROOF_PLAN demo script |
| GitHub repo | public repo |
| Experience questions (Walrus, AI Builder) | answer honestly |

## Rules on commits, history, prior work, updates during judging
- Prior work allowed if "completed or materially advanced during the Hackathon Duration". Starting fresh avoids the question.
- **Commits after the deadline: not addressed.** Ask on Discord; until answered, make no feature commits after 17:00 UTC on 10 Nov.
- One submission per person.
- Age 18+ (or age of majority), no sanctioned jurisdictions.

## Past winners and calibration
No Total Recall winners yet (results 17 Nov). Closest calibration is in
LANDSCAPE.md → "Past events and winners": the June 2026 Tatum x Walrus
hackathon used **the identical 30/30/20/20 rubric**.

## Open questions for organisers (ask in Tatum Discord #hackathon)
1. **Third special prize:** the event site lists "Best Use of Agent Payments ($500): x402 or MPP, settled on Sui"; the official rules page lists "Mystery Bounty ($500), revealed on Discord". Are these the same prize?
2. Are feature commits allowed after 17:00 UTC 10 Nov, during judging?
3. Is Sui testnet acceptable for money flows if memory is on mainnet?
4. Does "Tatum RPC where relevant" mean Sui only, or does any Tatum chain RPC count?
