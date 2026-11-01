import { api, type ApiResult } from "./api.ts";
import { walletStep, type WalletRole } from "./walletSteps.ts";

type Challenge = { readonly field: string; readonly nonce: string; readonly message: string; readonly signer: string };
type Approval = { readonly nonce: string; readonly signature: string };

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function approve(challenge: Challenge, role: WalletRole, network: "mainnet" | "testnet", status: HTMLElement): Promise<Approval> {
  return new Promise((resolve) => {
    status.textContent = `This needs your ${role} ${short(challenge.signer)}: connect it, then sign. Signing moves no money; nothing changes until every signature checks out.`;
    const box = walletStep({ role, expected: challenge.signer, message: challenge.message, network, status, onSigned: async (signature) => {
      box.remove();
      resolve({ nonce: challenge.nonce, signature });
    } });
    status.after(box);
  });
}

export async function withApprovals<T>(method: "POST" | "PUT" | "DELETE", path: string, body: Record<string, unknown>, network: "mainnet" | "testnet", status: HTMLElement): Promise<ApiResult<T>> {
  const first = await api<T>(method, path, body);
  const challenges = !first.ok && first.error.status === 428 ? (first.error.body?.["approvals"] as Challenge[] | undefined) : undefined;
  if (!challenges) return first;
  const approvals: Record<string, Approval> = {};
  for (const challenge of challenges) approvals[challenge.field] = await approve(challenge, challenge.field === "proof" && challenges.length > 1 ? "new wallet" : "owner wallet", network, status);
  status.textContent = "Checking the signature through Tatum…";
  return api<T>(method, path, { ...body, approvals });
}
