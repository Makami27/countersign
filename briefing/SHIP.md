# SHIP: Countersign v1

v1 = a stranger can open the URL on a phone, set up an agent, add payees, pay them, watch scams get refused, approve a real address change with their wallet, and verify every decision publicly. Each acceptance ID below becomes a test title or a recorded check in `evidence/`.

## 1. Users and surfaces
| Who | Where | Does |
|---|---|---|
| Owner | Telegram bot + owner web app (`/app`) | adds payees, asks the agent to pay, forwards messages, approves changes, sets caps |
| Payee | signing page (`/sign/:nonce`), opened from a link the owner shares | proves control of a wallet, approves an address change with their current wallet |
| Anyone (judges) | landing + lab (`/`), receipt (`/r/:receipt`), proof (`/proof`), status (`/status`) | tries to scam the sandbox agent; checks any decision |

## 2. Core features (all required for v1)
### Owner setup
- **V01** The owner links Telegram to the web app with a one-time code (hashed at rest, 10 min expiry, single use) → HttpOnly, Secure, SameSite=Strict session.
- **V02** First-run screen shows agent wallet address + USDC/SUI balance (via Tatum), memory status, caps; an empty state explains the next step in one sentence.

### Payees
- **V03** Add a payee: name + address (full address shown grouped) → payee gets a signing link to prove control → only then VERIFIED. Until then the payee is listed as "Waiting for the payee's wallet".
- **V04** Payee list + detail: payable address (grouped), countersignature line, address history (versions only), refused attempts, last payments.
- **V05** Truncated addresses appear only in lists; every decision screen shows the full grouped address.

### Paying
- **V06** Pay from Telegram ("pay rent 0.10") or the web Pay button (amount sheet with cap shown). One confirmation screen showing the full grouped address it will pay.
- **V07** Payment lifecycle persisted: RESERVED → SENDING → SENT → SETTLED / FAILED; SENDING → UNKNOWN reconciled by digest, never resent. UI shows each state with what happened to money.
- **V08** Per-payment and per-day caps from settings; refusal names the cap.

### Address changes
- **V09** Any message (Telegram text, forwarded email pasted in, lab) → extraction → engine. STATED records never payable.
- **V10** Refusals show the **comparison view** (grouped, matching groups dimmed, differing groups marked) and the VOID stamp; known-pattern refusals cite the earlier receipt.
- **V11** Genuine change: owner gets a share link; the payee's `/sign/:nonce` page connects a Sui wallet (wallet standard), signs the exact change message with the **current** wallet, then with the **new** wallet; status updates live on the owner's screen.
- **V12** Owner path: owner confirms in the web app with a fresh code from Telegram, then the cooldown (settings, default 24h; demo value labelled) must pass; the new wallet still proves control.
- **V13** Expired / reused / wrong-wallet signatures produce the named refusal with a next action.

### Proof and transparency
- **V14** Every outcome has a receipt page `/r/:receipt`: verdict, money sentence, reason, checks in order, Walrus Memory blob link, Sui transaction link (or "No transaction: nothing was sent"), timestamp.
- **V15** `/proof`: live counters from real data (payments, refusals by reason, memories on mainnet with namespace counts), the preregistered measurement table with denominators, and the CLAIMS ledger.
- **V16** `/status`: Tatum GraphQL + gRPC reachability, Walrus Memory relayer health, last restore completeness, network (mainnet/testnet), app version (git sha).
- **V17** Lab (`/`): sandboxed agent per visitor (exists), with the comparison view and receipts added.

### Memory and chain (from PRD)
- **V18** Records on Walrus Memory, signed by the agent; restore on boot with the completeness check; incomplete → payments disabled with a banner saying so.
- **V19** All chain reads, signature checks and payments through Tatum (or disclosed fallback per DECISIONS).

## 3. Quality bar (each is checked before submit)
| ID | Bar | Check |
|---|---|---|
| Q01 | Works at 360, 390, 768, 1024, 1440 px wide; no horizontal scroll; tap targets ≥ 44 px | Playwright screenshots + scrollWidth assertion for every route |
| Q02 | Light and dark themes, both ≥ 4.5:1 text contrast | axe-core run per route in both schemes, 0 serious violations |
| Q03 | Keyboard: every action reachable, visible focus ring, logical order; screen-reader labels on addresses | axe + manual tab-through recorded |
| Q04 | `prefers-reduced-motion`: stamp becomes a fade; no other autoplay motion | Playwright with reducedMotion |
| Q05 | Performance: public pages LCP < 2.0 s on simulated 4G, JS ≤ 100 KB gz on `/`, `/r/*`, `/proof`; fonts self-hosted WOFF2, subset | Lighthouse CI report in evidence/ |
| Q06 | Security: CSP without unsafe-inline, HSTS, no keys in client bundles, rate limits on lab + auth + webhook, session cookies HttpOnly/Secure/SameSite=Strict, CSRF on POSTs | header test + bundle secret scan |
| Q07 | Errors: every failure says whether anything changed and what to do next; no stack traces to users | copy review + tests on error routes |
| Q08 | Empty states for: no payees, no payments, no refusals, memory pending | screenshots |
| Q09 | Deployed at a public HTTPS URL; judges need no invite; health check green | `/status` screenshot in evidence/ |
| Q10 | `pnpm gate` green from a clean clone; README setup works verbatim | clean-clone run log |

## 4. Design
`briefing/DESIGN.md` (direction, tokens, principles) and the reference screens in `apps/web/design/` (`owner.html`, `sign.html`, `receipt.html`, `screens.css`, `addr.js`). The existing `apps/web/public/` landing + lab is the base: keep its look and extend it. Don't restyle it.

## 5. Out of scope for v1
Multisig/passkey payees, multiple owners per agent, fiat, other chains, email ingestion by IMAP (owner pastes or forwards to the bot instead), native mobile apps.
