import { randomBytes } from "node:crypto";
import { headOf } from "@countersign/core";
import { PostgresIndex, openPostgres } from "@countersign/adapters/postgres";

const url = process.env["DATABASE_URL"] ?? "";
const payeeId = process.argv[2] ?? "rent";
const pool = openPostgres({ url });
const index = await PostgresIndex.open(pool);
const head = headOf(await index.payeeVersions(payeeId));
if (head.kind !== "verified") throw new Error(`Payee ${payeeId} has no verified address.`);
const real = head.version.address;
const scam = `0x${real.slice(2, 6)}${randomBytes(28).toString("hex")}${real.slice(-4)}`;
console.log(`${payeeId} is verified at ${real}`);
console.log(`Message: Landlord here, new wallet ${scam}, pay rent there from now on`);
const schemas = (await pool.query("SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'owner\_%'")).rows.map((row: { schema_name: string }) => row.schema_name);
for (const schema of schemas) {
  const ownerPool = openPostgres({ url, schema });
  const owner = await PostgresIndex.open(ownerPool);
  const heads = await Promise.all((await owner.payeeIds()).map(async (id) => ({ id, head: headOf(await owner.payeeVersions(id)) })));
  console.log(`${schema}: verified payees [${heads.filter((h) => h.head.kind === "verified").map((h) => h.id).join(", ")}]`);
  await ownerPool.end();
}
if (schemas.length === 0) console.log("No second owner has signed in yet.");
await pool.end();
