# PLAN: Countersign, 30 Oct → 10 Nov 2026

Deadline: **Tue 10 Nov, 17:00 UTC = 18:00 WAT.** Internal submit target: **Tue 10 Nov, 13:00 UTC** (4 h buffer).
Build finishes **Mon 9 Nov, 18:00 UTC**. 10 Nov is only the pre-submit audit and the form.
No feature commits after 17:00 UTC on 10 Nov unless organisers confirm it's allowed (EVENT.md open question 2).

Revised 2026-10-30 (owner review of the phase plan): skeleton deploy moved to Phase 2, real mainnet use starts in Phase 2, Phase 3 gets an extra half day from Phase 4, submission deliverables added.

## Where we are (2026-10-31, ~20:01 UTC)
**Phase:** Phase 4; V20–V22 deployed on the custom domain. Gate: `pnpm gate`, 115 tests green.

**Deployed vs committed — read this first**
- Render runs `main` at https://countersign.nittings.xyz (custom domain, HTTPS; `PUBLIC_BASE_URL` points at it). `273dd39` went live 2026-10-31 23:09 UTC. `/api/health` reports the commit from `RENDER_GIT_COMMIT`. The old onrender.com host still answers.
- **Render auto-deploys every push to `main`.**
- Owner wallet registered on the new domain: 0xb2d3…6475 (Slush showed no warning there).

**Done**
- Phase 1: pnpm on Node 26 (D8); spikes (REALITY_SPIKES); Tatum adapters with a shared rate gate; MemWal adapter; digest-first payment ledger and runner (D11); Act 1.
- Phase 2: one process for agent, bot and web (D16); owner sign-in by one-time code; owner app `/app`; self-hosted fonts.
- Phase 3: onboarding only after the payee's wallet signs (D14); `/sign/:nonce`; two-signature change (V11); owner path with cooldown (V12); named refusals (V13).
- Hosting: Render free + Neon Postgres (D19); async ports with an atomic reserve and payee-head check; Fly destroyed. README "Known limits" covers free-tier restarts.
- Phase 4 so far: `/r/:receipt` (V14); `/api/status` (Postgres, Tatum gRPC and GraphQL, Walrus relayer, Telegram polling, Gemini stats); landing claims table generated from CLAIMS.md; owner-app timeouts and the promise lint.
- Acts 2–3 on Render (`evidence/acts/act2`, `act3`, CL14). Look-alikes and known attacks are now refused by code before the model; Gemini retries once on 429/5xx.
- V20 owner-wallet protection (D20, THREAT_MODEL.md): committed `1d47c7f`, **not deployed**.
- V21 scheduled payments (D21): monthly or yearly, owner-wallet signature to create/change/delete, one payment per period (`schedule:<id>:<period>`), late boot run, hourly retry only for retryable refusals, Telegram notice with receipt link; panel on the payee page. Committed, **not deployed**.
- V22 shared scam memory (D22): look-alike and known-attack refusals share a signed attack_seen record; other agents refuse that address with SEEN_BY_OTHER_AGENT (first receipt, distinct agent keys); never blocks a VERIFIED payee, continuity overrides, 90-day window, owner-signed retraction, no endpoint lists it. No retract button in the owner app yet (API only). Committed, **not deployed**.
- Real-use memories: 6 of 10 (CL07).

**Blocked / waiting**
- **Act 4**: fresh change request for Rent: current wallet `0x68f21c9f…b023b` → new wallet `0x993ae91d7f9aedfc2724f69ac263d437e6fcd4bde521d696a895932582679496`, nonce `7b77c6d4f82b4019e297e16f63c70df2`, expires 2026-11-01 23:59 UTC: https://countersign.nittings.xyz/sign/7b77c6d4f82b4019e297e16f63c70df2. Waiting for the owner to sign with the current wallet, then the new wallet; then pay 0.01 test USDC to Rent and capture into `evidence/acts/act4/` (`captureActs.ts` shows the pattern). The old request (nonce 875fe73f…) expires unsigned.
- Delegate key rotation after the relayer echoed it in an error (REALITY_SPIKES R4).

**Next steps**
1. Act 4: sign the change, pay Rent, capture.
2. Rest of Phase 4: `/proof` page, `/status` page, lab upgrade, preregistered measurement; real use to ≥10 memories.

**Background jobs and how to check them**
- None running. Deployed agent: Render service `srv-dbj08anf3r2c73ejrggg` (Ohio); health and dependency timings at `/api/health` and `/api/status`; an external 5-minute ping (cron-job.org) keeps it awake.

**Open decisions**
- Custom domain and registrar (owner).
- Neon free compute hours: idle loops skip the database so the compute can suspend; watch usage in the Neon console.
- Telegram polling vs webhook (polling; only one instance may poll).

## Workstreams
| Stream | Owns | Person |
|---|---|---|
| **A: Core + chain** | `packages/core` (sole owner of `types.ts`), Tatum adapters, payments, reconciliation | TBD |
| **B: Memory + agent** | MemWal adapter, signed records, restore/completeness, Gemini extraction, Telegram bot | TBD |
| **C: Web + proof + story** | owner app, proof page, attack lab, receipts UI, blog, video, posts | TBD |

## Phases (each ends with a gate; owner OK between phases)
| Phase | When (UTC) | Goal (definition of done) | Demo act captured |
|---|---|---|---|
| 1. Foundation + live integrations | Fri 30 Oct → Mon 2 Nov | pnpm only, `pnpm gate` green; spikes S1 S5 S6 S10 S2 S12 run and shown to the owner **before** adapter work; Tatum GraphQL + gRPC and MemWal adapters pass `pnpm test:live`; payment intents persisted (V07); a real testnet payment through Tatum with a receipt | **Act 1** (pay, receipt) |
| 2. Agent + owner core | Tue 3 → Wed 4 Nov | Telegram bot + owner login by one-time code (V01); `/app` payees, pay sheet, activity, settings, empty states (V02–V10); shared address/status/stamp components; **skeleton deployed at a public HTTPS URL**; **small real mainnet use starts as soon as the agent runs** | **Act 2 + 3** (scam refused with comparison view; repeat refused citing the receipt) |
| 3. Address changes | Thu 5 → Fri 6 Nov (2 days) | `/sign/:nonce` with wallet-standard signing, two-step live status (V11); owner path with fresh code + cooldown (V12); named refusals (V13); a real change verified with two real wallets on testnet | **Act 4** (real change; next payment goes to the new address) |
| 4. Proof surfaces + measurement | Sat 7 → Sun 8 Nov midday | `/r/:receipt` (V14), `/proof` (V15), `/status` (V16, polish trimmed first if short), lab upgrade (V17); preregistered measurement on testnet with denominators in `evidence/`; ≥10 real-use mainnet memories confirmed (A02); **blog draft with real numbers only**; **video script written Sun 8 Nov** | **Act 5** (proof page with measured table) |
| 5. Polish, hardening, deploy | Sun 8 pm → **Mon 9 Nov 18:00** | Q01–Q10: screenshots at 5 widths × 2 themes + reduced motion, axe, Lighthouse, self-hosted fonts, security headers, rate limits, CSRF, error copy; production deploy with persistent volume; README, THREAT_MODEL.md | — |
| Submit | Tue 10 Nov | pre-submit audit from a clean clone; fill the form; **submit by 13:00 UTC** | full video recorded from the script |

## Act captures
Each act is recorded as a short screen capture **the moment its gate passes**, saved to `evidence/acts/act<n>-<slug>.<ext>`, and listed in CLAIMS.md as evidence. Web screens are captured with Playwright video; Telegram screens are captured from the owner's device or Telegram Web. Testnet/mainnet and dev/mainnet relayer are visible or captioned in every capture.

## Network labelling
Memory writes go to the **dev relayer** for tests and the measurement, and to the **mainnet relayer** for real use. Payments run on **testnet** unless a run is explicitly mainnet real use. Every screen, receipt, evidence file and caption that shows a record, payment or number says which network and which relayer produced it.

## Cut lines (decide at the end of the named phase; ask the owner before cutting)
- **End of Phase 1:** if payments via Tatum aren't working → pay via the Sui SDK on the public fullnode, keep all *reads* and signature checks on Tatum, and disclose it.
- **End of Phase 3:** if the change flow isn't done → drop the round-trip path; keep continuity signature + owner path.
- **Phase 4:** trim `/status` polish first; then cut the attack lab upgrade to a recorded walkthrough; keep the measured table.
- **End of Phase 4:** cut every P1 (Move receipt event, MCP server, owner-app polish).
- **Never cut:** refusing STATED addresses, signed records, completeness check, UNKNOWN blocks payment, receipts, ≥10 real mainnet memories, honest labels, the measurement.

## Submission checklist
| Field | Value | Source | Status |
|---|---|---|---|
| Tatum ID | — | Tatum dashboard account ID | — |
| SUI address | — | owner's wallet | — |
| MemWal account ID | — | memory.walrus.xyz dashboard | — |
| MEMWAL_AGENT_ID | — | delegate **public** key under "Delegate keys" | — |
| Repo URL | — | public GitHub repo | — |
| Demo URL | — | Phase 5 deploy, health check green | — |
| Video (2–3 min) | — | recorded from the Sun 8 Nov script | — |
| Blog URL | — | published from the Phase 4 draft | — |
| Email, Discord, LinkedIn | — | owner | — |
| Description + experience questions | — | submission doc | — |

## Daily ritual (15 min, end of day)
1. `pnpm gate` green from a clean clone.
2. Update CLAIMS.md (PROVEN / NOT PROVEN) and the README status table.
3. Commit with a behavioural message (what's true now, how it was verified, test count).
4. If a demo act works, capture it **today** into `evidence/acts/`.

## Risks to watch daily
| Risk | Trigger | Response |
|---|---|---|
| S10 fails (Tatum can't verify PersonalMessage) | spike | verify with `@mysten/sui/verify` against Tatum GraphQL for zkLogin; disclose |
| S12 fails (recall incomplete) | spike | stop and show the owner; then rebuild via `restore()` + per-record recall by idempotency token; new D-entry |
| Relayer rate limits | 429 during measurement | smaller live sample, mock for logic, state the denominator |
| Tatum free tier (3 req/s) | 429s | client-side limiter at 2 req/s; cache reads; poll at most every 10 s |
| Gemini free tier | 429s | back off; queue as UNPROCESSED; never treat an outage as "no proposal" |
| Mainnet USDC for real use | Phase 2 | keep amounts tiny (≤ $0.10 per payment); caps in code |
| Wallet flags the host as malicious | Slush showed "Malicious website" for countersign-agent-7u1c.onrender.com on 31 Oct (alert id 9e1813c9-47b6-4edb-8562-f915fdd77fc0); owners and payees can't sign | own domain for the app; ask Slush/Mysten to review; the app only requests signPersonalMessage, never transactions; V20 and Act 4 wait for the domain |
