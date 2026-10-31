import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import type { RecordSigner } from "@countersign/core";

const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function verifies(key: KeyObject, canonical: string, signature: string): boolean {
  try {
    return verify(null, Buffer.from(canonical), key, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

function agentPublicKey(agentKey: string): KeyObject | null {
  const raw = Buffer.from(agentKey, "base64");
  if (raw.length !== 32) return null;
  try {
    return createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, raw]), format: "der", type: "spki" });
  } catch {
    return null;
  }
}

export function recordSignerFromSeed(seedBase64: string): RecordSigner {
  const seed = Buffer.from(seedBase64, "base64");
  if (seed.length !== 32) throw new Error("AGENT_RECORD_SIGNING_KEY must be 32 bytes, base64");
  const privateKey: KeyObject = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: "der", type: "pkcs8" });
  const publicKey = createPublicKey(privateKey);
  return {
    agentKey: publicKey.export({ format: "der", type: "spki" }).subarray(SPKI_ED25519_PREFIX.length).toString("base64"),
    sign: (canonical) => sign(null, Buffer.from(canonical), privateKey).toString("base64"),
    verify: (canonical, signature) => verifies(publicKey, canonical, signature),
    verifyAgent: (agentKey, canonical, signature) => {
      const key = agentPublicKey(agentKey);
      return key !== null && verifies(key, canonical, signature);
    },
  };
}
