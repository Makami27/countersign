# IDEA_CHECK: round 2 (very narrow problems)

Date: 2026-10-30
Companion to `IDEA_CHECK.md` (round 1: fake-alert checker, Precommit, tax
classifier, ROSCA). Same tests, same rubric.

---

## 1. Walrus storage expiry watchdog ("Keepalive")

### Would Walrus like it? Evidence

| Evidence | Source |
|---|---|
| Walrus Memory's own docs: "Expiry is the one part of the lifecycle that fails silently. A blob does not warn the agent before it lapses." They tell agents to build an extend-before-expiry loop themselves. | MemWal `docs/fundamentals/architecture/tracking-agent-storage.md` |
| "Once a blob lapses, you cannot recover its content, and you cannot renew a lapsed memory." | MemWal `docs/guides/manage-your-memory.md` |
| Automatic renewal exists **only for console uploads**. Self-managed and agent-owned blobs are the owner's job. | same |
| Walrus Memory writes default to **50 epochs** (about 2 years on mainnet, where an epoch is about 2 weeks; testnet epochs are about 1 day). The relayer transfers each memory's `Blob` object to the owner, so **every Walrus Memory user will eventually have to renew**. | MemWal `docs/reference/configuration.md` (`walrusEpochs` default 50), `services/server/src/jobs.rs` (MetaTransferJob) |
| `listMemories()` already returns `end_epoch` and `expires_at` per memory. | MemWal `docs/sdk/api-reference.md` |
| The Walrus CLI checks one blob at a time (`blob-status`); there is **no command to list all your blobs with expiry**. Only the owner can extend an owned blob; anyone can fund a *shared* blob. | [Managing blobs](https://docs.wal.app/docs/walrus-client/managing-blobs) |
| A third-party storage company (Lighthouse) sells managed Walrus renewal, so people do pay to solve this. | [Lighthouse blog](https://www.lighthouse.storage/blogs/Walrus%20Epochs%20and%20Renewal%3A%20Keeping%20a%20Blob%20Alive) |

**Answer: very likely yes.** It solves a gap Walrus documents in its own words.
It protects their users' data, and it drives renewals, which is WAL spend. It
also fits "Best Walrus Memory" in a way no other entrant does: the product is
about keeping memory alive. The risk is that Walrus builds this themselves
later. The console already auto-renews its own uploads, so the pitch has to be
"for everything the console doesn't cover".

### Hook
"Walrus deletes your files silently when their storage runs out. This won't let it."

### Who, the job, how they cope today, where it fails
- A builder whose app or agent wrote blobs through the CLI, SDK or a publisher.
- A Walrus Sites owner.
- Any Walrus Memory user.
Today they note an end epoch somewhere and hope. It fails when the person who
set it up leaves, a payment wallet runs dry, or nobody checks. Nothing warns
them.

### Hard core
1. **Inventory:** list every `Blob` object an address owns (current state, so no history-retention problem), with size, `end_epoch`, and whether it's shared or deletable. Read through Tatum's Sui gateway.
2. **Epoch → calendar + cost:** convert end epochs to dates with an error margin, and estimate WAL renewal cost per blob.
3. **Renewal under a budget:** "I have 5 WAL this month." Choose which blobs to extend by remembered importance, deadline and cost. That's a knapsack problem with a brute-force oracle test. Results are a union: `RENEW | LET_LAPSE | NEEDS_DECISION | UNKNOWN`.
4. **Safety:** the app never holds the owner's key. It builds the extend transaction and the user signs. A blob within the safety margin and still undecided gets escalated, never silently dropped.

### Thin-wrapper test
Passes. Inventory, dates, costs and budget choice are all code. The model
only explains a plan in plain words and suggests a label for an unlabelled
blob ("looks like a Walrus Site asset"). The user confirms.

### Sponsor deletion test
| Sponsor | Removed → what breaks | On critical path? |
|---|---|---|
| Walrus Memory | no memory of what matters, so it can't prioritise and asks about every blob each time | yes |
| Tatum Sui RPC | no inventory, no epochs, can't submit extends | yes |
| Walrus itself | it's the subject | yes |

### Where memory visibly changes the product
- Every renew or let-lapse decision is remembered per blob and **per pattern** (namespace, publisher, size class, Walrus Site). New blobs that match get a proposed decision automatically.
- Budget history: "You usually spend about 3 WAL a month. This month needs 7. Here's what to drop."
- Recursive demo moment: the watchdog's own memories live on Walrus Memory, and it keeps those alive too.

### Boundary
AI proposes: labels, plain-English plan.
Code decides: dates, costs, the renewal set under budget.
The model never: signs or submits an extend, marks a blob "safe to lapse", or changes the budget.

### The loop
scan → inventory with dates → recall past decisions → plan under budget → user signs extends → new end epochs recorded → **next scan proposes from memory and asks only about new kinds of blob**.
Step others skip: the deliberate *let lapse*, recorded with a reason.

### What we deliberately do not claim
No custody, no auto-signing, no guarantee against Walrus network failure. We
won't claim renewal for blobs owned by someone else (only shared blobs can be
funded by anyone).

### Risks
- **Nothing expires soon on mainnet by default** (memories last about 2 years). For the demo, store a few real mainnet blobs with a short term (1–2 epochs), plus a testnet run with 1-day epochs to show the full lapse cycle, clearly labelled.
- Track fit: Smart Agents ("agents that monitor workflows"). Fine, but the story has to stay human: "your files", not "blob objects".
- Querying owned `Blob` objects by type through Tatum's GraphQL needs a spike (S9).

### Demo feasibility (solo)
High. Your own wallet, your own blobs, real extend transactions you sign.

**Score: strong. Best sponsor fit of everything so far.**

---

## 2. Gas-sponsor wallet forecaster

### Evidence
Shinami's gas station docs say you top up "when your fund is running low",
but **don't describe any low-balance alert** ([Shinami](https://docs.shinami.com/product-overviews/sui/gas-station.md)).
EVM gas tanks (Gelato) do offer alerts. A Sui-side gap is plausible but
unconfirmed (their help centre wasn't checked).

### Hook
"Your gas sponsor wallet runs dry Saturday at 3am. Top it up Friday."

### Hard core
A burn-rate forecast with honest intervals (by weekday and hour), a "not
enough data" state, and a top-up recommendation with a safety margin.

### Thin-wrapper test
Passes.

### Sponsor deletion test
| Sponsor | Removed → what breaks | On critical path? |
|---|---|---|
| Tatum | no balance or spend data | yes |
| Walrus Memory | **weak**: burn history is a time series a normal database holds just as well | **no, fails the event's own test** |

### Risks
- Memory isn't doing work a database couldn't, which hurts the heaviest (30%) criterion.
- An honest demo needs a sponsor wallet with real traffic. Yours would have little; a public app's pool address could be watched read-only.
- Narrow audience (app builders), and Shinami may already alert.

**Score: weak for this event. Fails the "memory does real work" test.**

---

## 3. Spam-airdrop filter that learns

### Evidence
Spam tokens and NFTs on Sui are real: Mysten warned about spam coins in 2023
([CoinGape](https://coingape.com/scam-alert-mysten-labs-warns-of-token-spam-on-sui-wallets/)),
and the Sui forum has users unable to remove scam NFTs ([forum](https://forums.sui.io/t/security-block-when-trying-to-remove-scam-nfts-from-my-wallet/49180)).
Wallets such as Trust Wallet already offer hiding.

### Hook
"You hid it once. Every copy of that scam airdrop stays hidden, in every app."

### Hard core
Classify owned objects by exact Move type and package. A hide rule applies
only on an exact package/type match and never by name alone, so a real token
can't be hidden by a look-alike rule. Results: `HIDE | SHOW | ASK`.

### Thin-wrapper test
Passes.

### Sponsor deletion test
Memory: the angle is that your **hide list is portable** across wallets and
apps (an MCP server any wallet could query). That's real memory work. Tatum:
reads owned objects.

### Risks
- **Creativity:** wallets already hide spam, so "learns and travels with you" is the only edge.
- The demo needs real spam in a wallet. Yours may have some; otherwise send yourself test objects (labelled).
- A false hide could hide real money, so the code bar has to be strict.

**Score: medium. Real, but crowded by wallets themselves.**

---

## 4. Wrong-USDC send guard

### Evidence
Users have lost "USDC on Sui" sent to Binance; Binance said it couldn't
recover the funds ([Sui forum, Feb 2025](https://forums.sui.io/t/usdc-mistakenly-transferred-to-binance/47382)).
**But** the post doesn't say whether the token was bridged or native, and
Circle has a native-vs-bridged migration guide ([Circle](https://www.circle.com/blog/sui-migration-guide)).
The problem is real, but our specific cause is unproven.

### Hook
"This exchange only credits native USDC. You're about to send the bridged one."

### Hard core
Exact coin-type checks plus a per-recipient record of coin types that were
*actually accepted*.

### Critical gap
The chain can show that a transfer landed, but **not whether an exchange
credited it**. That happens off-chain. So "accepted" can only come from the
user telling us. The core claim isn't verifiable through Tatum.

### Risks
Narrowest audience; the key claim can't be verified; close to Veyra's
check-before-sending idea.

**Score: weak. The thing it protects against can't be proven from chain data.**

---

## 5. Forgotten-value finder

### Evidence
- Storage rebates come back only when you **delete** objects ([Sui storage fund](https://blog.sui.io/storage-fund-demystified/)). Telling a user what's safe to delete is dangerous.
- Sui staking rewards accrue inside the staked position and are paid on withdrawal, so "unclaimed rewards" is mostly not a real thing on Sui (unverified detail; check Sui tokenomics docs if pursued).

### Sponsor deletion test
Memory would only remember "ignore this". Weak.

**Score: drop. The premise is shaky and memory does little.**

---

## Round 2 comparison

| | Keepalive | Gas forecaster | Spam filter | USDC guard | Forgotten value |
|---|---|---|---|---|---|
| Narrow, real problem | **yes, documented by Walrus** | plausible | yes | real, cause unproven | shaky |
| Memory does real work | **yes** | no | yes (portable) | weak | weak |
| Tatum on critical path | yes | yes | yes | yes | yes |
| Data risk | low (current state) | low | low | high (off-chain) | medium |
| Solo demo | yes | weak | medium | weak | — |
| Sponsor delight | **very high** | low | medium | low | low |
| Verdict | **GO** | DROP | CHANGE | DROP | DROP |

## Overall shortlist (both rounds)
1. **Keepalive** (Walrus storage expiry watchdog): best sponsor fit, documented gap, solo demo, real memory.
2. **Fake-alert checker:** best "real life" story, lowest data risk.
3. ROSCA / Ajo Keeper, if you can get people for the demo.

Next spike before deciding between 1 and 2: **S9**, which lists owned `walrus::blob::Blob` objects with `end_epoch` through Tatum's Sui GraphQL.
