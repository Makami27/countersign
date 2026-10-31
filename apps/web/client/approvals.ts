import { api, type ApiResult } from "./api.ts";
import { signWith, signingWallets } from "./signFlow.ts";

type Challenge = { readonly field: string; readonly nonce: string; readonly message: string; readonly signer: string };
const MAX_ROUNDS = 2;

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export async function withApprovals<T>(method: "POST" | "PUT", path: string, body: Record<string, unknown>, network: "mainnet" | "testnet", status: HTMLElement): Promise<ApiResult<T>> {
  let current = body;
  for (let round = 0; ; round++) {
    const result = await api<T>(method, path, current);
    const challenges = !result.ok && result.error.status === 428 ? (result.error.body?.["approvals"] as Challenge[] | undefined) : undefined;
    if (!challenges || round >= MAX_ROUNDS) return result;
    const wallet = signingWallets()[0];
    if (!wallet) return { ok: false, error: { status: 0, message: "No Sui wallet was found in this browser. Nothing was changed.", body: null } };
    const approvals: Record<string, { nonce: string; signature: string }> = {};
    for (const challenge of challenges) {
      status.textContent = `Sign in ${wallet.name} with ${short(challenge.signer)}. Signing moves no money; nothing changes until every signature checks out.`;
      const step = await signWith(wallet, challenge.signer, challenge.message, network);
      if (!step.ok) return { ok: false, error: { status: 0, message: step.message, body: null } };
      approvals[challenge.field] = { nonce: challenge.nonce, signature: step.signed.signature };
    }
    status.textContent = "Checking the signature through Tatum…";
    current = { ...body, approvals };
  }
}
