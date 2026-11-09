import type { Overview, PayeeSummary } from "./types.ts";
import { balanceBand, type WalletActions } from "./views/walletPanel.ts";
import { sidebarParts, type SidePayees } from "./views/sidebar.ts";
import { pickPayeeSheet } from "./views/pickPayee.ts";
import { startScheduling } from "./views/schedules.ts";
import { PAYABLE } from "./views/payees.ts";
import { setSide, setWallet } from "./shell.ts";

export type DeskDeps = {
  readonly overview: Overview;
  readonly payees: SidePayees;
  readonly selected: string | null;
  readonly onPayeePage: boolean;
  readonly openPay: (id: string, name: string, address: string) => void;
  readonly openDeposit: () => void;
  readonly openAdd: () => void;
  readonly openCheck: () => void;
  readonly go: (path: string) => void;
  readonly rerender: () => void;
};

function payeePath(id: string): string {
  return `/app/payees/${encodeURIComponent(id)}`;
}

function walletActions(d: DeskDeps): WalletActions {
  const list = d.payees.ok ? d.payees.payees : [];
  const current = d.onPayeePage ? list.find((p) => p.id === d.selected && PAYABLE.has(p.status) && p.address) ?? null : null;
  const pay = (payee: PayeeSummary) => {
    if (payee.address) d.openPay(payee.id, payee.name, payee.address);
  };
  const schedule = (payee: PayeeSummary) => {
    startScheduling(payee.id);
    if (location.pathname === payeePath(payee.id)) d.rerender();
    else d.go(payeePath(payee.id));
  };
  return {
    onDeposit: d.openDeposit,
    onPay: () => (current ? pay(current) : pickPayeeSheet("Pay a payee", "Pay", list, pay, d.openAdd)),
    onSchedule: () => (current ? schedule(current) : pickPayeeSheet("Schedule a payment", "Schedule for", list, schedule, d.openAdd)),
  };
}

export function drawDesk(d: DeskDeps, quiet: boolean): void {
  const actions = walletActions(d);
  setWallet(balanceBand(d.overview, actions, "main"), quiet);
  setSide(sidebarParts(d.overview, d.payees, d.selected, {
    band: balanceBand(d.overview, actions, "phone"),
    onDeposit: d.openDeposit, onAdd: d.openAdd, onCheck: d.openCheck,
    onPay: (payee) => {
      if (payee.address) d.openPay(payee.id, payee.name, payee.address);
    },
  }), quiet);
}
