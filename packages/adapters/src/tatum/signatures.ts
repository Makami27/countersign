import { bcs } from "@mysten/sui/bcs";
import { fromBase64 } from "@mysten/sui/utils";
import type { SuiGrpcClient } from "@mysten/sui/grpc";
import type { SignatureResult, SignatureVerifier, SuiAddress } from "@countersign/core";

const ED25519_FLAG = 0x00;
const ZKLOGIN_FLAG = 0x05;
const SUPPORTED_FLAGS = new Set([ED25519_FLAG, ZKLOGIN_FLAG]);

export class TatumSignatureVerifier implements SignatureVerifier {
  readonly #client: SuiGrpcClient;

  constructor(client: SuiGrpcClient) {
    this.#client = client;
  }

  async verifyPersonalMessage(message: string, signature: string, address: SuiAddress): Promise<SignatureResult> {
    let raw: Uint8Array;
    try {
      raw = fromBase64(signature);
    } catch {
      return "INVALID";
    }
    const flag = raw[0];
    if (flag === undefined) return "INVALID";
    if (!SUPPORTED_FLAGS.has(flag)) return "UNSUPPORTED";
    const bytes = new TextEncoder().encode(message);
    try {
      const { response } = await this.#client.signatureVerificationService.verifySignature({
        message: { name: "PersonalMessage", value: bcs.byteVector().serialize(bytes).toBytes() },
        signature: { bcs: { value: raw }, signature: { oneofKind: undefined } },
        address,
        jwks: [],
      });
      return response.isValid === true ? "VALID" : "INVALID";
    } catch {
      return "UNKNOWN";
    }
  }
}
