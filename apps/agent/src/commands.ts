import { formatUsdc } from "@countersign/core";
import type { BalancesView } from "@countersign/web/ownerContext";
import { AGENT_WALLET_FULL, GOOGLE_WORDS, YOUR_WALLET } from "@countersign/web/walletFacts";
import { escapeHtml, groupedHtml } from "./telegramText.ts";

export type PayeeLine = { readonly name: string; readonly status: "verified" | "change_pending" | "attempt_refused" | "waiting_wallet" | "conflict" | "not_payable"; readonly address: string | null };
export type ScheduleLine = { readonly says: string; readonly nextDue: string | null };
type Network = "mainnet" | "testnet";

const STATUS_WORDS: Record<PayeeLine["status"], string> = {
  verified: "verified, payable",
  change_pending: "payable at its verified address; a change is waiting for proof",
  attempt_refused: "payable at its verified address; an attempt to change it was refused in the last day",
  waiting_wallet: "not payable yet: waiting for the payee's wallet to sign",
  conflict: "frozen: two verified records disagree, nothing will be paid",
  not_payable: "not payable: the signing link expired",
};

export const COMMANDS = [
  { command: "help", description: "What this bot can do" },
  { command: "payees", description: "Your payees and where each one is paid" },
  { command: "balance", description: "The agent wallet's balance" },
  { command: "schedules", description: "Your scheduled payments" },
  { command: "cancel", description: "Cancel a payment you haven't confirmed" },
  { command: "login", description: "Sign-in link for the owner app" },
] as const;

function networkWords(network: Network): string {
  return network === "mainnet" ? "Sui mainnet, real USDC" : "Sui testnet: test USDC, no real money";
}

function appLink(publicUrl: string | null): string {
  return publicUrl ? `${publicUrl}/app` : "the owner app";
}

export function helpText(publicUrl: string | null, network: Network): string {
  return [
    `Countersign pays your verified payees in USDC and refuses any address it can't prove. This agent runs on ${networkWords(network)}.`,
    "",
    "Pay someone: send \"pay rent 0.10\" (the payee's name, then the amount). You confirm with a button before anything is sent.",
    "Check a message: forward an email or chat about a payee here, or paste its text. A new address in it is never paid until the payee's own wallet proves it.",
    "",
    "Do you need a crypto wallet? No: continue with Google in the owner app.",
    GOOGLE_WORDS,
    "",
    "Two wallets:",
    AGENT_WALLET_FULL,
    YOUR_WALLET,
    "",
    ...COMMANDS.map((c) => `/${c.command}: ${c.description.charAt(0).toLowerCase()}${c.description.slice(1)}`),
    "",
    `Owner app: ${appLink(publicUrl)}. Add payees, change addresses, set schedules and limits there, signed with your own wallet.`,
  ].join("\n");
}

export function payeesHtml(payees: readonly PayeeLine[], publicUrl: string | null): string {
  if (payees.length === 0) return `No payees yet. Add one in the owner app: ${escapeHtml(appLink(publicUrl))}`;
  const lines = payees.map((p) => [`<b>${escapeHtml(p.name)}</b>: ${STATUS_WORDS[p.status]}`, p.address && p.status !== "waiting_wallet" && p.status !== "not_payable" ? groupedHtml(p.address) : null].filter(Boolean).join("\n"));
  return [...lines, "", "Pay with \"pay &lt;name&gt; &lt;amount&gt;\"."].join("\n\n");
}

function sui(baseUnits: bigint): string {
  const whole = baseUnits / 1_000_000_000n;
  const fraction = (baseUnits % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

export function balanceHtml(agentAddress: string, balances: BalancesView, network: Network): string {
  const test = network === "testnet" ? "test " : "";
  const amounts = balances.status === "KNOWN"
    ? `<b>${formatUsdc(balances.usdcBaseUnits)} ${test}USDC</b> and ${sui(balances.suiBaseUnits)} ${test}SUI for gas.`
    : `Balance not known right now: ${escapeHtml(balances.detail)}. Nothing is paid while the chain doesn't answer.`;
  return [`${AGENT_WALLET_FULL}, on ${networkWords(network)}:`, groupedHtml(agentAddress), "", amounts].join("\n");
}

export function schedulesText(schedules: readonly ScheduleLine[], publicUrl: string | null): string {
  if (schedules.length === 0) return `No scheduled payments. Set one up on a payee's page in the owner app: ${appLink(publicUrl)}`;
  const when = (iso: string | null) => (iso ? `next run ${iso.slice(0, 16).replace("T", " ")} UTC` : "no next run");
  return [...schedules.map((s) => `${s.says}, ${when(s.nextDue)}.`), "", "Each run re-checks the verified address, your caps and Walrus Memory. Change them in the owner app."].join("\n");
}

export function cancelText(cancelled: number, publicUrl: string | null): string {
  const changes = `Waiting address changes are cancelled in the owner app with your wallet's signature: ${appLink(publicUrl)}`;
  if (cancelled === 0) return `There's no payment waiting for your confirmation. Nothing was changed.\n\n${changes}`;
  return `Cancelled ${cancelled === 1 ? "the payment" : `${cancelled} payments`} waiting for your confirmation. Nothing was sent.\n\n${changes}`;
}
