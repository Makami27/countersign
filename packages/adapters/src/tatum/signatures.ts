import { bcs } from "@mysten/sui/bcs";
import { fromBase64 } from "@mysten/sui/utils";
import { parseSerializedSignature } from "@mysten/sui/cryptography";
import type { SuiGrpcClient } from "@mysten/sui/grpc";
import type { SignatureCheck, SignatureVerifier, SuiAddress } from "@countersign/core";
import { currentEpoch } from "./payments.ts";

const ED25519_FLAG = 0x00;
const ZKLOGIN_FLAG = 0x05;

type GatewayAnswer = "VALID" | "INVALID" | "UNKNOWN";

export class TatumSignatureVerifier implements SignatureVerifier {
  readonly #client: SuiGrpcClient;

  constructor(client: SuiGrpcClient) {
    this.#client = client;
  }

  async verifyPersonalMessage(message: string, signature: string, address: SuiAddress): Promise<SignatureCheck> {
    let raw: Uint8Array;
    try {
      raw = fromBase64(signature);
    } catch {
      return { result: "INVALID" };
    }
    const flag = raw[0];
    if (flag !== ED25519_FLAG && flag !== ZKLOGIN_FLAG) return { result: flag === undefined ? "INVALID" : "UNSUPPORTED" };
    const bytes = new TextEncoder().encode(message);
    const bound = await this.#ask(bytes, raw, address);
    if (bound === "UNKNOWN") return { result: "UNKNOWN" };
    if (bound === "INVALID") {
      const unbound = await this.#ask(bytes, raw, undefined);
      return { result: unbound === "VALID" ? "WRONG_SIGNER" : unbound === "UNKNOWN" ? "UNKNOWN" : "INVALID" };
    }
    const epoch = await currentEpoch(this.#client);
    if (epoch === null) return { result: "UNKNOWN" };
    return flag === ZKLOGIN_FLAG
      ? { result: "VALID", scheme: "ZKLOGIN", maxEpoch: zkLoginMaxEpoch(signature), checkedAtEpoch: epoch.toString() }
      : { result: "VALID", scheme: "ED25519", maxEpoch: null, checkedAtEpoch: epoch.toString() };
  }

  async #ask(bytes: Uint8Array, raw: Uint8Array, address: SuiAddress | undefined): Promise<GatewayAnswer> {
    try {
      const { response } = await this.#client.signatureVerificationService.verifySignature({
        message: { name: "PersonalMessage", value: bcs.byteVector().serialize(bytes).toBytes() },
        signature: { bcs: { value: raw }, signature: { oneofKind: undefined } },
        ...(address === undefined ? {} : { address }),
        jwks: [],
      });
      return response.isValid === true ? "VALID" : "INVALID";
    } catch {
      return "UNKNOWN";
    }
  }
}

function zkLoginMaxEpoch(signature: string): string | null {
  const parsed = parseSerializedSignature(signature);
  return parsed.signatureScheme === "ZkLogin" ? String(parsed.zkLogin.maxEpoch) : null;
}
