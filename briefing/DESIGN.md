# DESIGN: Countersign v1

Base: the existing landing + lab in `apps/web/public/` (built in parallel on 30 Oct). Its direction is kept and extended. Reference screens for everything new: `apps/web/design/owner.html`, `sign.html`, `receipt.html` (+ `screens.css`, `addr.js`). Screenshots of them at 390/1440, light and dark, were reviewed on 30 Oct.

## Subject, audience, job
- **Subject:** a guard between an AI agent and the wallets it pays. Its world: cheques, countersignatures, security printing, the VOID stamp.
- **Audience:** a person or small business whose agent pays rent, freelancers and suppliers in USDC, mostly on a phone; judges on a laptop.
- **Primary job:** make obvious in under a second *which address will actually get paid, and why it's trusted.*

## Tokens (from `apps/web/public/styles.css`, plus `--stated` added for v1)
| Name | Light | Dark | Role |
|---|---|---|---|
| `--paper` | `#E9F0EA` | `#0E1626` | background: cool cheque stock, not cream |
| `--paper-raised` | `#F4F8F4` | `#1A2740` | cheque surfaces |
| `--ink` | `#18233D` | `#E4ECE6` | text, primary buttons |
| `--seal` | `#0F6B5C` | `#6FD1BC` | verified, payable |
| `--stated` | `#8A5A00` | `#F2B95C` | stated, waiting for proof (new) |
| `--void` | `#B3261E` | `#FF7A6B` | refusals, the VOID stamp |
| `--focus` | `#1F5FD1` | `#8AB4FF` | focus rings |

## Type
- **Familjen Grotesk** for all UI and display text, sentence case.
- **Martian Mono (87.5% width)** only for wallet addresses, digests and the signed message, where character-by-character comparison is the task. Never for labels.
- **Self-host both as subset WOFF2** (`apps/web/design/fonts/` has the OFL TTFs). The current page loads Google Fonts, which breaks under strict networks and adds a third-party origin to the CSP.

## The one memorable thing
**Addresses are typeset for comparison.** Every address on a decision screen is set in 4-character groups. On a refused look-alike, the groups the scammer copied are dimmed, the groups that differ are bold void-red with a heavy underline, and a rotated VOID stamp sits beside the heading: the only non-user-triggered animation in the product (a fade under reduced motion). Verified addresses carry a countersignature line. Everything else stays quiet.

## Layout
- **Phone first.** Single column, cheque cards (guilloche strip on the left edge, 6px radius, 1px border, no shadow), sticky bottom action bar on detail screens.
- **≥ 960px:** owner app is two panes (380px list | detail ≤ 860px). Public pages use the existing centred column.
- Left-aligned text; numbers right-aligned in tables.

## Principles
1. Status is colour plus words ("Verified", "Change waiting for proof", "Attempt refused"), never colour alone.
2. Every outcome starts by saying what happened to money: "Nothing was sent and nothing was changed." / "Sent 0.10 USDC to Flat 4B rent."
3. Proof is one tap away: every verdict links to its receipt; every receipt links to Walrus Memory and Sui.
4. Numbered markers only for real sequences: change signatures (1, 2) and the checks the agent ran, in order. Address history uses version labels (v1, v2) plus "Refused" rows.
5. Focus visible (2px ring), reduced motion respected, contrast ≥ 4.5:1 in both themes, tap targets ≥ 44px.
6. Avoid: all-caps eyebrows, monospace labels, identical shadowed cards, gradient washes, "→" on buttons, middle-dot meta strings.
