import { createHash, generateKeyPairSync, verify, type KeyObject } from "node:crypto";
import type { SignatureCheck, SuiAddress } from "@countersign/core";

export type Wallet = { readonly address: SuiAddress; readonly key: KeyObject; readonly publicKey: KeyObject };

const LAB_EPOCH = "lab sandbox";

function signedBy(wallet: Wallet, message: string, signature: string): boolean {
  try {
    return verify(null, Buffer.from(message), wallet.publicKey, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

export function labVerify(wallets: ReadonlyMap<SuiAddress, Wallet>, message: string, signature: string, address: SuiAddress): SignatureCheck {
  const expected = wallets.get(address);
  if (expected && signedBy(expected, message, signature)) return { result: "VALID", scheme: "ED25519", maxEpoch: null, checkedAtEpoch: LAB_EPOCH };
  return [...wallets.values()].some((w) => signedBy(w, message, signature)) ? { result: "WRONG_SIGNER" } : { result: "INVALID" };
}

export function newWallet(): Wallet {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const address = `0x${createHash("sha256").update(publicKey.export({ format: "der", type: "spki" })).digest("hex")}` as SuiAddress;
  return { address, key: privateKey, publicKey };
}
