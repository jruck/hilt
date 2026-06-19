import { normalizeForParity } from "../src/lib/local-apps/parity";
import { scanLocalApps } from "../src/lib/local-apps/scanner";

const oracleUrl = process.env.PORT_AUTHORITY_ORACLE_URL || "http://hestia.tailc0acaa.ts.net:47878/v1/services";

async function main() {
  const oracle = await fetch(oracleUrl).then((res) => {
    if (!res.ok) throw new Error(`Port Authority oracle returned ${res.status}`);
    return res.json();
  });
  const hilt = await scanLocalApps();
  const left = JSON.stringify(normalizeForParity(oracle), null, 2);
  const right = JSON.stringify(normalizeForParity(hilt), null, 2);
  if (left !== right) {
    console.error("Local Apps parity mismatch against Port Authority oracle.");
    console.error("Oracle and Hilt normalized snapshots differ. Re-run with live services steady, then inspect IDs/grouping/classification.");
    process.exit(1);
  }
  console.log("Local Apps parity passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
