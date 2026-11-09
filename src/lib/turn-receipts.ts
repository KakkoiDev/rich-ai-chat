import { createHash } from "node:crypto";
import { runWithReceipt, type ReceiptStore } from "@kakkoidev/ai-core";

/** One ledger per reply. Durable job and todo writes have their own SQLite receipts. */
export function createTurnReceipts() {
  type Row = { id: string; fingerprint: string } & ({ state: "pending" } | { state: "done"; result: unknown });
  const rows = new Map<string, Row>();
  const store: ReceiptStore<unknown> = {
    reserve(identity) {
      const existing = rows.get(identity.id);
      if (existing) return existing;
      rows.set(identity.id, { ...identity, state: "pending" });
      return { ...identity, state: "new" };
    },
    settle(receipt) { rows.set(receipt.id, { ...receipt, state: "done" }); },
  };
  return <T>(id: string, tool: string, input: unknown, run: () => Promise<T>) => {
    const fingerprint = createHash("sha256").update(JSON.stringify([tool, input], (_key, value) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value)).digest("hex");
    return runWithReceipt(store as ReceiptStore<T>, { id, fingerprint }, run);
  };
}
