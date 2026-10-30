# Prompt: build Countersign v1 with Claude Code

Paste everything below the line into Claude Code, opened at the repo root, with `.env` and `spikes/.env` filled in.

---

You are building **Countersign v1**, a shippable product for the Walrus × Tatum "Total Recall" hackathon (deadline Tue 10 Nov 2026, 17:00 UTC; our submit target is 13:00 UTC on 10 Nov). It must be finished, standout, beautifully designed and work on every device. "Finished" is defined by `briefing/SHIP.md`, not by you.

## 0. Read first, in order
1. `CLAUDE.md`: invariants, conventions, honesty rules. They override your defaults.
2. `briefing/SHIP.md`: v1 scope, acceptance IDs V01–V19 and quality bars Q01–Q10.
3. `briefing/PRD.md`: the engine rules (§6 change, §6b payment, state machines).
4. `briefing/DESIGN.md` and the reference screens in `apps/web/design/` (open `owner.html`, `sign.html`, `receipt.html` in a browser and look at `design/screenshots/`).
5. `briefing/DECISIONS.md`, `BUILD_CONTRACT.md`, `FAILURE_MODES.md`, `FEASIBILITY.md`, `REALITY_SPIKES.md`, and `briefing/knowledge/*`.
6. The existing code: `packages/core` (engine, 19 tests), `packages/adapters`, `apps/agent`, and **`apps/web` (landing + attack lab, built in parallel; it's the design base, so extend it, don't restyle it)**.

Then reply with: (a) Countersign in 5 bullets, (b) the 5 invariants you consider most important, (c) your phase plan with time estimates. Wait for my OK before Phase 1.

## Non-negotiables
- AI proposes, code decides. Nothing in a message can create a VERIFIED address. UNKNOWN (Tatum, Walrus Memory, model) blocks payment. UNKNOWN payments are never resent.
- No fabrication: no fake data shown as real, no invented numbers, show `—` until real. Label testnet and demo data everywhere they appear.
- No comments in code (`pnpm check:comments`), strict TS, no `any`, closed error codes, behaviour-named tests with SHIP/PRD IDs in titles.
- Don't edit `packages/core/src/types.ts` or the engine's rules without telling me first.
- Keys only in `.env`. Never log, print, commit or bundle them. `pnpm check:secrets` before every commit.
- Commit as you go with behavioural messages (what's true now, how verified, test count). Never rewrite history.
- Verify library APIs against the installed source in `node_modules`, not memory. If a pinned version doesn't exist, use the nearest real one and add a D-entry.
- New ideas go to `ROADMAP.md`.

## Phases (each ends with a gate; report and wait for my OK between phases)

### Phase 1: Foundation and live integrations
- `pnpm install`, fix type errors until `pnpm gate` passes (typecheck has never run).
- Run `spikes/` (S1, S5, S6, S10, S2, S12; S13 only after I confirm a throwaway wallet). Record results in `REALITY_SPIKES.md`; apply the fallbacks in `FEASIBILITY.md` if S10 or S12 fail. **If S12 fails, stop and show me.**
- Make the Tatum (GraphQL + native gRPC) and MemWal adapters pass a live suite `pnpm test:live` (separate from the unit gate).
- Persist payment intents (V07) in SQLite with CHECK-constrained states and digest reconciliation.
- **Gate:** unit + live suites green; a real testnet payment through Tatum with a receipt (Act 1). CLAIMS.md updated only with evidence paths.

### Phase 2: Agent and owner core
- Telegram bot: owner-only, pay command, forwarded messages → extraction → engine, replies from `apps/agent/src/replies.ts`. Owner web login by one-time code from the bot (V01).
- Owner web app `/app`: payees list + detail (V03–V05), pay sheet with confirmation (V06, V08), activity, settings, first-run and empty states (V02, Q08). Build it in the style of `design/owner.html`, using the tokens in `apps/web/public/styles.css` (add `--stated`).
- Shared components: grouped address with comparison mode (port `design/addr.js` to a typed module with tests: grouping, same/diff marking, aria-label), status pills, cheque card, VOID stamp, receipt link.
- **Gate:** V01–V10 tested; Acts 2–3 recorded (scam refused with comparison view; repeat refused citing the receipt).

### Phase 3: Address changes end to end
- `/sign/:nonce` in the style of `design/sign.html`. Wallet connection via the Sui **wallet standard** in a small browser bundle (esbuild; check `@mysten/wallet-standard` / dApp Kit in node_modules and pick the lightest that works without a framework; add a D-entry). Sign the exact change message with the current wallet, then the new wallet; live status on the owner screen (V11).
- Owner path with fresh code + cooldown (V12); named refusals for expired, reused and wrong-wallet signatures (V13).
- **Gate:** a real change verified with two real wallets on testnet, and the next payment goes to the new address (Act 4).

### Phase 4: Proof surfaces
- `/r/:receipt` (V14) in the style of `design/receipt.html`; `/proof` with live counters + the measurement table + the claims ledger (V15); `/status` (V16); lab upgraded with the comparison view and receipt links (V17).
- Run the preregistered measurement (PRD) on testnet with the real model, throttled to the relayer budget; publish denominators and raw results in `evidence/`.
- Real use on mainnet with small real payments until ≥ 10 memories come from real use (A02).
- **Gate:** V14–V19 green; measurement file exists; Act 5 recorded.

### Phase 5: Polish, hardening, deploy
- Design QA loop for **every route**: Playwright screenshots at 360, 390, 768, 1024, 1440 in light and dark, plus a reduced-motion run. Assert no horizontal scroll and tap targets ≥ 44px. Review the screenshots yourself, fix, repeat until clean. Save the final set to `evidence/screens/`.
- axe-core on every route in both themes: 0 serious violations (Q02, Q03). Lighthouse on public routes (Q05). Fonts: self-host subset WOFF2 from `apps/web/design/fonts/` and drop Google Fonts from the CSP.
- Security headers, rate limits, CSRF, cookie flags, bundle secret scan (Q06). Error copy review (Q07).
- Deploy to a public HTTPS host with a persistent volume for SQLite (Railway or Fly; add a D-entry), health check green (Q09). Clean-clone run of the README (Q10).
- README per `proof-and-honesty` order (status first, verify-it-yourself, judge path, guarantees table, real/simplified/not built). THREAT_MODEL.md. Blog draft with real numbers only.
- **Gate:** the pre-submit audit in the skill guide, every item ticked or disclosed.

## Design rules (from DESIGN.md, enforced in review)
- Extend the existing landing's look: Familjen Grotesk, Martian Mono only for addresses/digests/signed text, cool paper, ink, seal green, void red, stated amber.
- The memorable element is the **grouped address comparison + VOID stamp**. Keep everything else quiet: no gradients, no shadows on cards, no all-caps labels, no "→" on buttons, no animations besides the stamp and user-triggered transitions.
- Every outcome sentence starts with what happened to money. Errors say what happened and what to do next.
- Full grouped addresses on every decision screen; truncation only in lists.

## How to report at the end of each phase
1. What's now true, each with the command or evidence file that proves it.
2. What failed and what you changed (with D-entries).
3. Gate output, test count, SHIP IDs now green.
4. Screenshots of new screens (phone + desktop).
5. CLAIMS.md and REALITY_SPIKES.md diffs.
6. Risks to the deadline and any cut line from `briefing/PLAN.md` you recommend. Ask before cutting.
