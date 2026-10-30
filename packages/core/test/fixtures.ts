import { createHash, generateKeyPairSync, randomBytes, sign, verify, type KeyObject } from "node:crypto";
import { Countersign, type Caps, type RoundTripChecker } from "../src/engine.ts";
import { InMemoryIndex, InMemoryMemory, InMemoryPaymentLedger } from "../src/testing/inMemory.ts";
import type { RecordSigner, SignatureVerifier } from "../src/ports.ts";
import type { InboundMessage, SuiAddress } from "../src/types.ts";
import type { SignatureResult } from "../src/vocabulary.ts";

export type TestWallet = { readonly address: SuiAddress; sign(message: string): string };

const walletKeys = new Map<SuiAddress, KeyObject>();

export function wallet(): TestWallet {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const address = `0x${createHash("sha256").update(publicKey.export({ format: "der", type: "spki" })).digest("hex")}` as SuiAddress;
  walletKeys.set(address, publicKey);
  return { address, sign: (message) => sign(null, Buffer.from(message), privateKey).toString("base64") };
}

export function lookalikeOf(address: SuiAddress): SuiAddress {
  return `0x${address.slice(2, 6)}${randomBytes(28).toString("hex")}${address.slice(-4)}` as SuiAddress;
}

export class StandInVerifier implements SignatureVerifier {
  unreachable = false;
  async verifyPersonalMessage(message: string, signature: string, address: SuiAddress): Promise<SignatureResult> {
    if (this.unreachable) return "UNKNOWN";
    const key = walletKeys.get(address);
    if (!key) return "INVALID";
    try {
      return verify(null, Buffer.from(message), key, Buffer.from(signature, "base64")) ? "VALID" : "INVALID";
    } catch {
      return "INVALID";
    }
  }
}

export function recordSigner(): RecordSigner {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    sign: (canonical) => sign(null, Buffer.from(canonical), privateKey).toString("base64"),
    verify: (canonical, signature) => {
      try {
        return verify(null, Buffer.from(canonical), publicKey, Buffer.from(signature, "base64"));
      } catch {
        return false;
      }
    },
  };
}

export class FixedClock {
  current: Date;
  constructor(iso: string) {
    this.current = new Date(iso);
  }
  now(): Date {
    return this.current;
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

let messageCounter = 0;
export function message(text: string, from = "unknown@mail"): InboundMessage {
  messageCounter += 1;
  return { id: `m${messageCounter}`, channel: "lab", from, text, receivedAt: "2026-10-30T10:00:00Z" };
}

export const ONE_USDC = "1000000";
export const DEFAULT_CAPS: Caps = { perPaymentBaseUnits: 50_000_000n, perDayBaseUnits: 100_000_000n };

export async function world(caps: Caps = DEFAULT_CAPS) {
  const memory = new InMemoryMemory();
  const index = new InMemoryIndex();
  const signer = recordSigner();
  const signatures = new StandInVerifier();
  const clock = new FixedClock("2026-10-30T10:00:00Z");
  let n = 0;
  const roundTrips: RoundTripChecker = { check: async () => "NOT_PROVEN" };
  const payments = new InMemoryPaymentLedger();
  const deps = { ownerId: "owner1", memory, index, payments, signer, signatures, roundTrips, clock, nonces: { next: () => `n${++n}${randomBytes(4).toString("hex")}` }, caps, cooldownMs: 24 * 3600 * 1000 };
  const agent = new Countersign(deps);
  const landlord = wallet();
  const designer = wallet();
  await agent.onboardPayee("landlord", landlord.address, "owner-confirm-1");
  await agent.onboardPayee("designer", designer.address, "owner-confirm-2");
  return { agent, deps, memory, index, payments, signer, signatures, clock, landlord, designer };
}
