# Threat model

What each attacker can and can't do to a Countersign owner's money. "Owner wallet" is the Sui wallet the owner registered in the web app (V20).

## Someone who controls the owner's Telegram account
They can send the bot messages and ask for /login codes, so they can sign in to the owner app.

They **can**:
- Pay a payee that is already VERIFIED, within the per-payment and daily caps. The money goes only to that payee's verified address.
- See the owner app: payees, activity, receipts, settings.
- Start an address change request. It stays STATED (never payable) until the payee's current wallet signs it, or the owner wallet confirms it and the cooldown passes; the new wallet must also sign.
- Tighten limits (lower caps, longer cooldown).
- Ask to replace the owner wallet without the old wallet's signature. That waits 72 hours, sends Telegram notices, and the real owner can cancel it with the owner wallet.

They **can't** (each needs a fresh owner-wallet signature over the exact action, checked through Tatum):
- Add a payee.
- Confirm an address change on the owner path.
- Raise a cap or shorten the cooldown.
- Create, change or delete a scheduled payment (V21).
- Retract a shared scam report (V22).
- Replace the owner wallet immediately.

Every sensitive action also sends a Telegram notice, so the owner sees it even if the attacker reads the chat.

## What wallets are asked to do
The owner app and the payee signing page only ever call a wallet's `standard:connect` and `sui:signPersonalMessage`. They never ask a wallet to sign or send a transaction; signing these messages moves no money.

## Someone who sends the owner a scam message
They can only make the model propose something. A new address is never payable from a message: it needs the payee's current wallet (or the owner wallet plus the cooldown) and the new wallet. A look-alike of a known address, or an address refused before, is refused by code before the model is asked.

## Another Countersign agent, or someone posing as many
Shared scam memory (V22) holds only attacker addresses, signed by the reporting agent's key. A report can make this agent refuse an address that comes in a message, or a new payee with that address. It **can't** block a payee that is already VERIFIED here, stop a payment, or stop a change the payee's current wallet signs. Agent keys are cheap, so the count of reporting agents is evidence, not proof. A report can be retracted only by the agent that signed it, and only with its owner wallet's signature. Nothing lists the blacklist.

## Someone with a copy of the database (Neon)
The database is an index; Walrus Memory is the source of truth for payees, receipts and the owner wallet, and every record there is signed by the agent. Editing a payee row in Postgres doesn't survive the next boot, which rebuilds the index from Walrus Memory. Login codes and sessions are stored only as hashes.

## Limits of this model
- If the owner wallet itself is stolen together with Telegram, the attacker can do everything the owner can.
- The first owner-wallet registration is trust-on-first-use: whoever is signed in to the owner app first, through a Telegram /login code, registers the owner wallet. If an attacker already controls Telegram before the owner registers, they can register their own wallet. Registration sends a Telegram notice, so register right after setting up the bot and check that notice. Replacing a registered wallet later needs the old wallet's signature or the 72-hour wait.
- A false shared report blocks onboarding that address here for 90 days unless the reporting agent retracts it; the owner can still change an existing payee to it if the payee's current wallet signs.
- The agent's own keys (record signing, payment wallet) live in the host's environment. Someone who controls the host can sign records and move the agent wallet's funds; caps don't bind a compromised host.
