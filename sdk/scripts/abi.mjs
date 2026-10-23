// Regenerates src/abi.ts from shared/abis (written after `forge build`).
import fs from "node:fs";
let out = "// Generated from contracts/out by sdk/scripts/abi.mjs. Do not edit.\n";
for (const c of ["SternpostGovernor", "SternpostFactory", "SpendWallet"]) {
  const abi = JSON.parse(fs.readFileSync(new URL(`../../shared/abis/${c}.json`, import.meta.url)));
  out += `export const ${c[0].toLowerCase() + c.slice(1)}Abi = ${JSON.stringify(abi)} as const;\n`;
}
fs.writeFileSync(new URL("../src/abi.ts", import.meta.url), out);
