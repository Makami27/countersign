# DESIGN: Countersign, "the signing desk"

Replaces the v1 cheque-stock direction (30 Oct). The old reference screens in `apps/web/design/` are retired; the code in `apps/web/public/` and `apps/web/client/` is the reference now.

## Concept
A bank keeps a signature card on file and compares every cheque with it. Countersign does that for wallets. Signatures are the playful element, and they do a job: every address is drawn as a signature, so a look-alike *looks* wrong before you read a single character. The real check is still the address: the grouped hex comparison stays on every decision screen.

- **Audience:** a person or small business whose agent pays rent, freelancers and suppliers in USDC, mostly on a phone; judges on a laptop.
- **Primary job:** make obvious in under a second *which address will actually get paid, and why it's trusted.*

## Generated signatures (`apps/web/client/scrawl.ts`)
- Pure, used by client and server: `scrawlFor(address)` returns one flowing stroke (1–3 loops, the first a big capital loop), a long tail (flick or back-sweep), an optional crossing underline and 1–2 dots. `scrawlMarkup()` renders it server-side; `scrawlEl()` in `dom.ts` renders it in the browser.
- Seeded from a 128-bit hash of the **full** lower-cased address, so one changed character anywhere gives a different scrawl. Deterministic.
- Always captioned **"Drawn from the address"** on a signature line. Never a name, never a copy of a real signature.
- Shown on: signature cards (payee list, payee page, demo cards, landing hero), /sign, receipts. On refusals: the verified scrawl and the attempted scrawl side by side, the VOID stamp over the attempted one, then the grouped hex comparison.
- Tests (`apps/web/test/signatures.test.ts`, V26): same address → same scrawl; Rent `0x68f2…023b` vs the look-alike `0x68f215db…663b023b` differ in path and in loop count or tail angle; 300 addresses all distinct, each with 1–3 loops and 1–2 dots.

## Wordmark
"counter" as a single hand-drawn SVG stroke (authored in `apps/web/client/wordmark.ts`; no handwriting photo was provided) plus "sign" in Familjen Grotesk. On the landing the stroke draws itself once on load (stroke-dashoffset, 1.2 s); under reduced motion it is shown complete. Static everywhere else. Favicon: the "co" of the stroke on paper.

## Tokens (`apps/web/public/tokens.css`, linked by every page; no hard-coded colours elsewhere)
| Token | Light | Dark | Role |
|---|---|---|---|
| `--paper` | `#F6F8FD` | `#0F1A3A` | page |
| `--paper-raised` | `#FFFFFF` | `#16244B` | signature cards |
| `--paper-deep` | `#E8EDF8` | `#0A1430` | insets, side column |
| `--ink` | `#141B33` | `#EAF0FF` | text |
| `--ink-soft` | `#4A5470` | `#AEBADB` | secondary text |
| `--ballpoint` | `#2340C8` | `#9DB1FF` | signatures, links, primary buttons, focus |
| `--stamp` / `--stamp-wash` | `#C8321E` / `#FCEBE7` | `#FF7A66` / `#3B1F2E` | VOID, refusals |
| `--highlight` / `--on-highlight` | `#FFE45C` / `#7A5A00` | `#5A4A00` / `#FFE45C` | stated, waiting for proof |
| `--seal` / `--seal-wash` | `#0F7A5F` / `#E1F3EC` | `#6FD9BC` / `#12363D` | verified |

Every text/background pair was checked ≥ 4.5:1 (tightest: stamp red on light `--paper-deep`, 4.55; highlighter text 5.02 light, 6.84 dark). No changes to the specified values were needed.

**Type:** Familjen Grotesk everywhere (self-hosted WOFF2 subset); Martian Mono at 87.5% width only for addresses, digests and signed messages. No script fonts; handwriting is SVG strokes only.

## Layout
- Phone first, left-aligned, 16 px gutter on phones.
- **Only payees are cards** (signature card: name, status, scrawl on a signature line, address). Everything else is lists and lines: refusals are a section under a stamp-red rule, pending changes a highlighter-ruled block, proof/status/receipt sections are separated by hairlines, not boxes.
- `/app` and `/demo`: tabs on phones, columns from 960 px (`/app`: payees | detail; `/demo`: letters | cards | activity).
- Landing (v2, 2 Nov): one job per section, in full-width bands alternating paper and inset paper. Sticky header: wordmark, in-page links (Demo, How it works, Memory, Proof, FAQ), Status, GitHub, "Sign in with your wallet", "Try the demo"; on phones the links sit in a `<details>` menu. Sections: hero (unchanged) → the problem (IC3 2025 and the Dec 2025 look-alike loss, both cited) → watch it decide (Acts 2–3 replayed from `evidence/acts`) → how it works → a month with Countersign (the loud moment: rubber date stamps, Acts 1–4 receipts, dates marked illustrative) → memory → shared scam memory → measured → same message, two agents (measurement trial K4 #1 from the raw rows) → what it does → built on Sui and Walrus through Tatum → FAQ → final call to action → footer. Every figure, transcript and comparison is read from evidence files or `/api/proof` at request time; a missing file is said plainly, never filled in. Only the hero card, the date stamps and the two-agent comparison are loud. The claims ledger lives on /proof.
- Landing script: one module, `build/landing.js` (under 1 KB), for the replay and the live counters (`/api/proof` `live`, cached 5 min on the server; "—" when unknown). Without it the page is complete.

## Motion (only these four)
1. The wordmark drawing on the landing.
2. A signature drawing itself the first time a payee is seen verified in this browser (`.scrawl.draw`; remembered in localStorage, which only decides the animation).
3. The VOID stamp landing. Under reduced motion it fades (Q04) and the drawings appear complete.
4. The landing replay of Acts 2–3: each step appears once, in order, when it first scrolls into view. Under reduced motion it is shown complete.

## Principles kept
1. Every outcome starts with what happened to money ("Nothing was sent and nothing was changed.").
2. Status is colour plus words, never colour alone.
3. Addresses in 4-character groups; on a comparison the differing groups are red, bold and underlined, copied groups are dimmed.
4. Tap targets ≥ 44 px, visible 2 px focus ring, CSP `'self'` (no inline styles or scripts), the network label on every page.
5. Waiting on memory is visible; a timeout is "not confirmed yet", never success.
6. Q01–Q05: every route at 360/390/768/1024/1440, light and dark, no horizontal scroll (`scripts/design-shots.ts` checks scrollWidth), axe 0 serious, JS budget on public pages.

## Status (1 Nov, evening)
Done and deployed: every route (landing, /demo, /app payees, payee page, add-payee sheet, activity, settings with funding and Connect Telegram, admin, sign-in, /sign onboarding / change / Done, /r, /proof, /status). The getting-started checklist sits above the payees until every required step is done (Telegram is optional), then folds below them. `apps/web/design/` is retired; font sources moved to `apps/web/fonts-src/`.

Checks (`AXE=1 node scripts/design-shots.ts <dir> 360,390,768,1024,1440`): every route at 5 widths x 2 themes, no horizontal scroll, 0 serious or critical axe violations, tap targets >= 44 px except inline text links and the settings checkbox (its 44 px label is the target). The landing, /r, /proof and /status ship no JavaScript. Contact sheets (390 and 1440, light and dark): `evidence/screens/signing-desk/<route>.png`.

Not covered: a paid receipt shows no signature (the receipt view carries no payee address for payments); the first-run screen of an empty account is styled by the same rules but has no screenshot (the screenshot world always has payees); wallet popups not checked in a real browser.

Next: Lighthouse LCP on simulated 4G (Q05), and a real-phone pass of /sign with Slush.
