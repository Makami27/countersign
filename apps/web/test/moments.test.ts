import { test } from "node:test";
import assert from "node:assert/strict";
import { STAMP_NOTES, notePayees, payeeEvents, readMuted, writeMuted, type StoreLike } from "../client/momentFacts.ts";

const A = `0x${"ab".repeat(32)}`;
const B = `0x${"cd".repeat(32)}`;

function memoryStore(): StoreLike {
  const items = new Map<string, string>();
  return { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => void items.set(key, value) };
}

const broken: StoreLike = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };

test("M01 the mute choice is remembered, and blocked storage reads as sound on without throwing", () => {
  const store = memoryStore();
  assert.equal(readMuted(store), false);
  writeMuted(store, true);
  assert.equal(readMuted(store), true);
  writeMuted(store, false);
  assert.equal(readMuted(store), false);
  assert.equal(readMuted(broken), false);
  assert.equal(readMuted(null), false);
  assert.doesNotThrow(() => writeMuted(broken, true));
});

test("M02 the stamp sound is short and quiet", () => {
  const ends = STAMP_NOTES.map((note) => note.at + note.length);
  assert.ok(Math.max(...ends) <= 0.5);
  assert.ok(STAMP_NOTES.every((note) => note.volume > 0 && note.volume <= 0.3));
});

test("M03 a payee moment fires when a payee becomes payable or its verified address changes, and never on first sight", () => {
  const waiting = { id: "rent", name: "Rent", payable: false, address: A };
  const verified = { ...waiting, payable: true };
  const moved = { ...verified, address: B };
  assert.deepEqual(payeeEvents(null, [verified]), []);
  assert.deepEqual(payeeEvents({}, [verified]), []);
  assert.deepEqual(payeeEvents({ rent: { payable: false, address: A } }, [verified]), [{ kind: "verified", name: "Rent", address: A }]);
  assert.deepEqual(payeeEvents({ rent: { payable: true, address: A } }, [moved]), [{ kind: "changed", name: "Rent", address: B }]);
  assert.deepEqual(payeeEvents({ rent: { payable: true, address: A } }, [verified]), []);
  assert.deepEqual(payeeEvents({ rent: { payable: false, address: A } }, [waiting]), []);
});

test("M03 what was seen is remembered between visits, and blocked storage only loses the moment", () => {
  const store = memoryStore();
  const waiting = { id: "rent", name: "Rent", payable: false, address: A };
  assert.deepEqual(notePayees(store, [waiting]), []);
  assert.deepEqual(notePayees(store, [{ ...waiting, payable: true }]).map((e) => e.kind), ["verified"]);
  assert.deepEqual(notePayees(store, [{ ...waiting, payable: true }]), []);
  assert.deepEqual(notePayees(broken, [waiting]), []);
});
