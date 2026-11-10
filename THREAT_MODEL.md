# Threat model

What each attacker can and can't do to a Countersign owner's money. "Owner wallet" is the Sui wallet the owner registered in the web app (V20).

## Someone who controls the owner's Telegram or Discord account
Discord, like Telegram, can only pay verified payees within caps; sensitive actions need your wallet. Everything in this section applies to a linked Discord account exactly as to a linked Telegram chat: both bots run the same code for paying, checking messages and answering commands.

They can send the bot messages (Telegram) or run its slash commands (Discord). Since V23 they can't sign in to the owner app: signing in needs the owner wallet's signature over a one-time message, and /login only replies with the sign-in link.

They **can**:
- Pay a payee that is already VERIFIED, within the per-payment and daily caps. The money goes only to that payee's verified address.
- Start an address change request by forwarding a message. It stays STATED (never payable) until the payee's current wallet signs it, or the owner wallet confirms it and the cooldown passes; the new wallet must also sign.

They **can't**:
- Sign in to the owner app, see it, or change any setting there (V23).

Someone with your unlocked browser can pay verified payees within caps for up to 7 days; sign out on shared computers. A session lasts 7 days from your last visit (each visit renews it), and signing out ends it on the server at once.

And even someone signed in to the owner app can't do these without a fresh owner-wallet signature over the exact action, checked through Tatum:
- Add a payee.
- Confirm an address change on the owner path.
- Raise a cap or shorten the cooldown.
- Create, change or delete a scheduled payment (V21).
- Retract a shared scam report (V22).
- Replace the owner wallet immediately (without the old wallet's signature it waits 72 hours with Telegram and Discord notices, and the owner wallet can cancel it).

Every sensitive action also sends a notice to the linked Telegram chat and Discord DM, so the owner sees it even if the attacker reads one of them. If Discord refuses the DM (for example, the app shares no server with the owner), the notice is kept in Activity in the owner app and the next Discord command reply says so once.

Linking: a Telegram link or Discord code is made only inside a signed-in owner app session, works once, expires after 10 minutes and is stored only hashed. A chat or Discord account is bound to the owner whose session made it, and to one owner at a time. Someone else's Discord account can never act on your agent, and an unlinked one is told to sign in and nothing is stored.

## What wallets are asked to do
The owner app and the payee signing page only ever call a wallet's `standard:connect` and `sui:signPersonalMessage`. They never ask a wallet to sign or send a transaction; signing these messages moves no money.

## Someone who sends the owner a scam message
They can only make the model propose something. A new address is never payable from a message: it needs the payee's current wallet (or the owner wallet plus the cooldown) and the new wallet. A look-alike of a known address, or an address refused before, is refused by code before the model is asked.

## Another Countersign agent, or someone posing as many
Shared scam memory (V22) holds only attacker addresses, signed by the reporting agent's key. A report can make this agent refuse an address that comes in a message, or a new payee with that address. It **can't** block a payee that is already VERIFIED here, stop a payment, or stop a change the payee's current wallet signs. Agent keys are cheap, so the count of reporting agents is evidence, not proof. A report can be retracted only by the agent that signed it, and only with its owner wallet's signature. Nothing lists the blacklist.

## Another owner on the same agent (V24)
Each owner's runtime uses its own Postgres schema, record-signing key and agent wallet; a session opens exactly one owner. Another owner can't list, pay, change, approve, schedule or retract anything of yours through the owner app, even by guessing ids (tested). Signing links (/sign/...) and receipts (/r/...) are public by design: whoever has the link can see them.

## Someone who gets MASTER_KEY
New owners' agent wallets and record keys are stored sealed with MASTER_KEY (AES-256-GCM) in Postgres and, as ciphertext, in Walrus Memory. Whoever has MASTER_KEY and either copy can spend every non-admin owner's agent wallet and sign records as their agent. **Losing MASTER_KEY loses those keys and the funds in those wallets**; the admin's keys come from the host environment and are not affected. Keep an offline copy.

## Someone with a copy of the database (Neon)
The database is an index; Walrus Memory is the source of truth for payees, receipts and the owner wallet, and every record there is signed by the agent. Editing a payee row in Postgres doesn't survive the next boot, which rebuilds the index from Walrus Memory. Login codes and sessions are stored only as hashes.

## Limits of this model
- If the owner wallet itself is stolen together with Telegram, the attacker can do everything the owner can.
- The first owner-wallet registration is trust-on-first-use: whoever is signed in to the owner app first, through a Telegram /login code, registers the owner wallet. If an attacker already controls Telegram before the owner registers, they can register their own wallet. Registration sends a Telegram notice, so register right after setting up the bot and check that notice. Replacing a registered wallet later needs the old wallet's signature or the 72-hour wait.
- A false shared report blocks onboarding that address here for 90 days unless the reporting agent retracts it; the owner can still change an existing payee to it if the payee's current wallet signs.
- The agent's own keys (record signing, payment wallet) live in the host's environment. Someone who controls the host can sign records and move the agent wallet's funds; caps don't bind a compromised host.
