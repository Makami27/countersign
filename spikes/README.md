# Countersign live spikes

These calls couldn't run from Claude's workspace, which blocks Tatum, Walrus and Sui hosts. Run them on your machine.

## Setup (about 5 minutes)
1. Node 22.23.4+ (`node -v`).
2. `cp .env.example .env` and fill in:
   - `TATUM_API_KEY`: dashboard.tatum.io
   - `MEMWAL_PRIVATE_KEY`, `MEMWAL_ACCOUNT_ID`: memory.walrus.xyz/dashboard → Delegate keys
   - `WALLET_A_PRIVATE_KEY`: a **throwaway** Sui wallet (`suiprivkey1…`) with ~0.05 SUI
   - `WALLET_B_ADDRESS`: any second address you control
3. `npm install`

## Run
- `npm run spikes`: read-only Tatum checks + signature verification + 3 labelled Walrus Memory writes in a separate spike namespace. **No money moves.**
- `npm run spikes:pay`: also sends 0.000001 SUI from wallet A to wallet B through Tatum and times when it becomes visible.

## What it tests
| ID | Question |
|---|---|
| S1 | Does Tatum's Sui GraphQL work with our key? Is JSON-RPC really gone? |
| S5 | Does Tatum's native gRPC answer with `x-api-key` metadata? |
| S6 | Can we list a wallet's transactions with balance changes, and how far back? |
| S10 | **Can Tatum verify a payee's signed message and reject the wrong address?** (core of Countersign) |
| S2 | Does a Walrus Memory mainnet write return a blob id, and how long does it take? |
| S12 | **Does recall return every record in a small namespace?** (our rebuild-from-memory design depends on it) |
| S13/S11 | Does a payment execute through Tatum, and how fast can we see it? |

Send back the `evidence/spikes-*.json` file it writes. It has no keys in it (they're redacted).
