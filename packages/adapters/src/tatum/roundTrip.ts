import type { ControlProof, RoundTripChecker, RoundTripResult, SuiAddress } from "@countersign/core";
import type { TatumGraphql } from "./graphql.ts";

type BalanceChange = { readonly owner: { readonly address: string } | null; readonly amount: string; readonly coinType: { readonly repr: string } };
type TxShape = { readonly transaction: { readonly sender: { readonly address: string } | null; readonly effects: { readonly status: string; readonly balanceChanges: { readonly nodes: readonly BalanceChange[] } } } | null };

const QUERY = `query ($d: String!) { transaction(digest: $d) {
  sender { address }
  effects { status balanceChanges { nodes { owner { address } amount coinType { repr } } } }
} }`;

export class TatumRoundTripChecker implements RoundTripChecker {
  readonly #graphql: TatumGraphql;
  readonly #agentAddress: SuiAddress;
  readonly #coinType: string;

  constructor(graphql: TatumGraphql, agentAddress: SuiAddress, coinType: string) {
    this.#graphql = graphql;
    this.#agentAddress = agentAddress;
    this.#coinType = coinType;
  }

  async check(proof: Extract<ControlProof, { kind: "round_trip" }>, toAddress: SuiAddress): Promise<RoundTripResult> {
    if (proof.outDigest === proof.returnDigest) return "NOT_PROVEN";
    const [out, back] = await Promise.all([this.#graphql.query<TxShape>(QUERY, { d: proof.outDigest }), this.#graphql.query<TxShape>(QUERY, { d: proof.returnDigest })]);
    if (!out.ok || !back.ok) return "UNKNOWN";
    const outOk = this.#moved(out.data, this.#agentAddress, toAddress, proof.amountBaseUnits);
    const backOk = this.#moved(back.data, toAddress, this.#agentAddress, proof.amountBaseUnits);
    return outOk && backOk ? "PROVEN" : "NOT_PROVEN";
  }

  #moved(tx: TxShape, from: SuiAddress, to: SuiAddress, amount: string): boolean {
    const t = tx.transaction;
    if (!t || t.sender?.address !== from || t.effects.status !== "SUCCESS") return false;
    const credit = t.effects.balanceChanges.nodes.filter((c) => c.owner?.address === to && c.coinType.repr === this.#coinType && c.amount === amount);
    return credit.length === 1;
  }
}
