import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import type { RecordSigner } from "@countersign/core";

const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export function recordSignerFromSeed(seedBase64: string): RecordSigner {
  const seed = Buffer.from(seedBase64, "base64");
  if (seed.length !== 32) throw new Error("AGENT_RECORD_SIGNING_KEY must be 32 bytes, base64");
  const privateKey: KeyObject = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: "der", type: "pkcs8" });
  const publicKey = createPublicKey(privateKey);
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
