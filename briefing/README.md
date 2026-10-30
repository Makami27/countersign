# Briefing: Total Recall (Walrus x Tatum)

Researched: 2026-10-30
Skill: research-and-coding-skill-guide

Load these files at the start of every build session. They are the evidence
behind every design call; if something here turns out wrong, fix the file
and note it in DECISIONS.md.

## Time left

As of 2026-10-30 06:50 WAT: deadline is **2026-11-10 17:00 UTC = 18:00 WAT
(Lagos)**. About 11.5 days. The build window opened 2026-10-20, so other
entrants are already 1–10 days in.

## Research queue (phase 0)

Every named technology, standard, sponsor and track from the event pages:

| Item | Needed for | Status |
|---|---|---|
| Walrus Memory (MemWal SDK, mainnet relayer, delegate keys) | Mandatory | `knowledge/walrus-memory.md` |
| Tatum Sui RPC (gRPC / GraphQL gateways) | Mandatory, judged under Technical Quality | `knowledge/tatum-sui.md` |
| Tatum Data API (prices, prediction-market data) | Track 1 / Track 3 ideas | after idea pick |
| Tatum Storage API (Walrus file upload) | Optional | after idea pick |
| x402 / MPP settled on Sui | "Best Use of Agent Payments" (see EVENT.md conflict) | after idea pick |
| Tatum AI Builder (ai.tatum.io) | Optional $500 prize | noted in EVENT.md |
| Sui Move (only if the idea needs a contract) | Idea-dependent | after idea pick |

Out of scope unless the idea needs it: Seal internals, self-hosted relayer,
Nautilus, Walrus Sites.

## Phase status

| # | Phase | File | Status |
|---|---|---|---|
| 0 | Scope | this file | done |
| 1 | Event | `EVENT.md` | done |
| 2 | Landscape + past winners | `LANDSCAPE.md` | done |
| 2b | Stakeholders + major past winners | `STAKEHOLDERS.md` | done (Walrus Console now auto-renews → expiry watchdog downgraded) |
| 3 | Idea check | `IDEA_CHECK.md`, `IDEA_CHECK_NARROW.md`, `IDEA_CHECK_FINAL.md` | **Countersign chosen** (D1) |
| 4 | Knowledge | `knowledge/` | done: walrus-memory, tatum-sui, sui-signing-and-usdc, memory-poisoning |
| 5 | Reality spikes | `REALITY_SPIKES.md` | queued, not run (needs your API keys) |
| 6 | Failure modes | `FAILURE_MODES.md` | done |
| 7 | Plan + agent guide | `PRD.md`, `../CLAUDE.md`, `BUILD_CONTRACT.md`, `DECISIONS.md` | v0.1 done; stack defaults pending team (D5) |
| 5b | Feasibility (offline) | `FEASIBILITY.md`, `../feasibility/` | done: F1 14/14, F2 15/15; 2 design changes (D6, D7) |
| 5c | Live spikes | `../spikes/` | ready to run on your machine (sponsor hosts blocked here) |
| 7b | Build plan | `PLAN.md` | done: day-by-day to 10 Nov, cut lines, workstreams |
| 8 | Scaffold | repo root | done: core engine + SQLite + extraction guard tested (23 tests); Tatum/MemWal adapters written, untested live; web app not built |
| 8b | v1 spec + design | `SHIP.md`, `DESIGN.md`, `../apps/web/design/` | done: V01–V19, Q01–Q10; owner/sign/receipt reference screens reviewed at 390/1440 light+dark |
| 8c | Claude Code prompt | `../CLAUDE_CODE_PROMPT.md` | done |
| 9–10 | Proof → audit | — | after live spikes |
