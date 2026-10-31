import type { ServerResponse } from "node:http";
import type { SignatureVerification, SuiAddress } from "@countersign/core";
import { problem, send } from "./http.ts";
import { APPROVAL_PROBLEMS, type ApprovalKind, type Approved, type Payload } from "./ownerApprovals.ts";
import type { OwnerContext } from "./ownerContext.ts";

export type Need = { readonly field: string; readonly kind: ApprovalKind; readonly payload: Payload; readonly signer: SuiAddress; readonly role: SignatureVerification["role"] };
export type Granted = Extract<Approved, { ok: true }> & { readonly role: SignatureVerification["role"] };

function signed(value: unknown): { nonce: string; signature: string } | null {
  if (value === null || typeof value !== "object") return null;
  const { nonce, signature } = value as { nonce?: unknown; signature?: unknown };
  return typeof nonce === "string" && typeof signature === "string" && signature.length > 0 && signature.length < 4096 ? { nonce, signature } : null;
}

export function proofsOf(granted: readonly Granted[]): { signer: SuiAddress; message: string; signature: string }[] {
  return granted.map((g) => ({ signer: g.signer, message: g.message, signature: g.signature }));
}

export function verificationsOf(granted: readonly Granted[]): SignatureVerification[] {
  return granted.map((g) => ({ role: g.role, signer: g.signer, scheme: g.check.scheme, maxEpoch: g.check.maxEpoch, checkedAtEpoch: g.check.checkedAtEpoch }));
}

export async function requireApprovals(ctx: OwnerContext, res: ServerResponse, input: Record<string, unknown>, needs: readonly Need[]): Promise<Granted[] | null> {
  const given = (input["approvals"] ?? {}) as Record<string, unknown>;
  if (needs.some((n) => !signed(given[n.field]))) {
    const approvals = await Promise.all(needs.map(async (n) => ({ field: n.field, ...(await ctx.approvals.challenge(n.kind, n.payload, n.signer)) })));
    send(res, 428, { error: "This needs a signature from your wallet. Nothing has changed yet.", approvals });
    return null;
  }
  const granted: Granted[] = [];
  for (const need of needs) {
    const answer = signed(given[need.field]);
    const result = answer ? await ctx.approvals.check(need.kind, need.payload, need.signer, answer.nonce, answer.signature) : ({ ok: false, problem: "APPROVAL_MISMATCH" } as const);
    if (!result.ok) {
      send(res, 403, { error: APPROVAL_PROBLEMS[result.problem], approval: { problem: result.problem } });
      return null;
    }
    granted.push({ ...result, role: need.role });
  }
  for (const need of needs) {
    if (!(await ctx.approvals.consume(signed(given[need.field])?.nonce ?? ""))) {
      send(res, 403, { error: APPROVAL_PROBLEMS.APPROVAL_USED, approval: { problem: "APPROVAL_USED" } });
      return null;
    }
  }
  return granted;
}

export async function ownerSigned(ctx: OwnerContext, res: ServerResponse, input: Record<string, unknown>, kind: ApprovalKind, payload: Payload): Promise<Granted[] | null> {
  const state = ctx.wallets.state();
  if (!state.known) {
    problem(res, 503, `${state.why} Nothing was changed. Try again shortly.`);
    return null;
  }
  if (!state.current) {
    send(res, 409, { error: "Register your owner wallet first (Settings). Sensitive changes need its signature. Nothing was changed.", ownerWallet: null });
    return null;
  }
  return requireApprovals(ctx, res, input, [{ field: "owner", kind, payload, signer: state.current.address, role: "continuity" }]);
}
