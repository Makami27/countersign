# PLAN: Countersign, 30 Oct → 10 Nov 2026

Deadline: **Tue 10 Nov, 17:00 UTC = 18:00 WAT.** Internal submit target: **Tue 10 Nov, 13:00 UTC** (4 h buffer).
Build finishes **Mon 9 Nov, 18:00 UTC**. 10 Nov is only the pre-submit audit and the form.
No feature commits after 17:00 UTC on 10 Nov unless organisers confirm it's allowed (EVENT.md open question 2).

Revised 2026-10-30 (owner review of the phase plan): skeleton deploy moved to Phase 2, real mainnet use starts in Phase 2, Phase 3 gets an extra half day from Phase 4, submission deliverables added.

## Where we are (2026-11-01, ~17:00 UTC)
**Phase:** Phase 4 plus V20–V25 (team decision 1 Nov), all deployed. Gate: `pnpm gate`, 146 tests green at `31579d2`.

**Deployed vs committed — read this first**
- Render runs `main` at https://countersign.nittings.xyz (custom domain, HTTPS; `PUBLIC_BASE_URL` points at it). `/api/health` reports the deployed commit (`RENDER_GIT_COMMIT`). **Render auto-deploys every push to `main`.** The old onrender.com host still answers.
- Live now: everything through V25 (`31579d2`). Multi-user (V24) runs **admin-only** because `MASTER_KEY` is not set on Render yet.
- Owner wallet (admin): `0xb2d3c105022325393f44d66927510729bc82eb7675d2fe45368dfb6e96bd6475`, registered on the custom domain.

**Done since V22 (newest last)**
- Fix before deploy (D23): only attack refusals become known-attack memory; a verified payee's address never matches; README limit for shared memory (one Walrus account).
- Deployed on the custom domain; Act 4 captured (`evidence/acts/act4`, CL15): Rent's current wallet then the new wallet signed; 0.01 test USDC settled to the new wallet via `payPayee.ts`. /sign shows Done / expired / unknown; wallet popups open straight from clicks (not yet checked in a real browser); wallets named by role.
- CL07 PROVEN: 12 agent-signed records from real use on the mainnet relayer (`evidence/a02-memory-count.json`).
- Owner inputs: login code box (later removed by V23), weekly and two-week schedules (ISO-week and fixed-pair keys), typed values no longer wiped by the payee-page refresh, caps and addresses checked before any signature.
- /proof (V15) and /status (V16), server-rendered; /proof labels the measurement partial or not run.
- Neon (D19): idle loops never touch the database; /status caches 5 min, its DB check 15 min; the 5-minute ping only hits /api/health.
- Groq first, Gemini fallback, plain pay commands by code (D26); /status shows provider, fallbacks and Groq requests left today. GROQ_API_KEY is on Render.
- Measurement re-preregistered on Groq (PRD Amendment 1, before any Groq trial). Gemini pilot (12 attack trials: Countersign 0, baseline 9) in `evidence/measurement/pilot-gemini/`.
- V23 wallet sign-in (D27): login codes removed; first wallet registers as owner wallet; /login replies with the link. A stolen Telegram can't open the owner app.
- V24 multi-user (D24): schema-per-owner runtimes (admin stays in `public`), sign-in creates owners (MAX_OWNERS), per-owner agent wallet and record key sealed with MASTER_KEY and backed up to Walrus as ciphertext, Telegram linking per owner, faucet links, checklist, "check a message" paste box (channel `paste`), admin page, hourly allowances. Cross-user tests in `apps/web/test/crossUser.test.ts`.
- V25 public /demo (D25): sandbox letters (genuine, look-alike, fake history, forged record, paste your own), signature cards, activity; landing CTAs.

**Blocked / waiting**
- **MASTER_KEY**: the owner said it is in `.env`, but `.env` has no MASTER_KEY line (file last saved 1 Nov 08:45). Once it's there: copy MASTER_KEY, `ADMIN_WALLET=0xb2d3c105022325393f44d66927510729bc82eb7675d2fe45368dfb6e96bd6475` and `MAX_OWNERS=8` to Render with the API (PUT `/v1/services/srv-dbj08anf3r2c73ejrggg/env-vars/<NAME>`, never print values), redeploy (push or POST `/deploys`), check /api/health and that the boot log shows no owner-load errors.
- Delegate key rotation (REALITY_SPIKES R4): steps agreed; do it after the measurement finishes.

**Next steps**
1. MASTER_KEY step above, then sign in as a second owner to check multi-user live.
2. Measurement done (CL16): Countersign 0/90 attacker payments, naive baseline 71/90 (K5 0/10 and K6 1/10 because the model rarely read those as address changes), benign 50/50 paid right, 0 false refusals, 0 model or trial errors.
3. Check wallet popups and Telegram linking in a real browser and phone.
4. Phase 5 essentials (Q01–Q10), blog and video. The mainnet switch comes last and is the first cut (SHIP); if cut, the header says "mainnet: coming later".

**Background jobs and how to check them**
- None running. Groq measurement finished 1 Nov; results committed.
- Deployed agent: Render service `srv-dbj08anf3r2c73ejrggg` (Ohio); /api/health, /api/status, /status; an external 5-minute ping (cron-job.org) keeps it awake.

**Open decisions**
- Neon free compute: set min and max to 0.25 CU; watch compute-hours in the Neon console.
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
