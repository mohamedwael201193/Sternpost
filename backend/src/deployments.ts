import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Chain addresses, read from the repo's single source of truth
 * (`shared/deployments/testnet.json`) instead of hardcoding them.
 *
 * Precedence everywhere: explicit env var > this file > the documented
 * fallback in `config.ts`. When the file is absent (e.g. the Vercel
 * serverless bundle, which does not ship `shared/`), this returns `{}` and
 * the env / fallback values apply — the backend must never crash for a
 * missing deployment file.
 *
 * The 0.9 Classic redeploy (2026-11-15) in that file:
 * Factory 0x39779A8678424CF78c841F9AfEa1EAFF3Cf7F6d8, Governor
 * 0x1bF45cFE654a397F4FF3B33bC1b157c88Ee71F38, Router
 * 0xd6833f811e987f06a1e55a435d4be38c6d4188d4, SpendWallet
 * 0x4F878203175B1BB6C63Ec02CEEBE1af4A7c9Ee4a (testnet 31611).
 */
export interface DeploymentAddresses {
  factory?: string;
  governor?: string;
  spendWallet?: string;
  router?: string;
  musd?: string;
  troveManager?: string;
  priceFeed?: string;
  /** Demo borrower from the file's `liveFlow` (test helper / smoke test). */
  borrower?: string;
}

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const pick = (v: unknown): string | undefined =>
  typeof v === "string" && ADDR.test(v) ? v : undefined;

function candidates(): string[] {
  const here = dirname(fileURLToPath(import.meta.url)); // backend/src
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of [
    join(here, "..", "..", "shared", "deployments", "testnet.json"),
    join(here, "..", "shared", "deployments", "testnet.json"),
    join(process.cwd(), "shared", "deployments", "testnet.json"),
    join(process.cwd(), "..", "shared", "deployments", "testnet.json"),
  ]) {
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

/** Reads `shared/deployments/testnet.json`; `{}` when it cannot be read. */
export function deploymentFileAddresses(): DeploymentAddresses {
  for (const p of candidates()) {
    try {
      const j = JSON.parse(readFileSync(p, "utf8")) as any;
      const s = j?.sternpost ?? {};
      const m = j?.mezo ?? {};
      return {
        factory: pick(s?.SternpostFactory?.address),
        governor: pick(s?.governor),
        spendWallet: pick(s?.spendWallet),
        router: pick(s?.SternpostRouter?.address),
        musd: pick(m?.MUSD),
        troveManager: pick(m?.TroveManager),
        priceFeed: pick(m?.PriceFeed),
        borrower: pick(j?.liveFlow?.borrower),
      };
    } catch {
      // Not this candidate (or not valid JSON) — try the next one.
    }
  }
  return {};
}

/**
 * SortedTroves is NOT in `shared/deployments/testnet.json` (the file's
 * `mezo` section has no such key). Value from MEZO_RESOURCES.md §2.2
 * (mezo-org/musd deployment JSONs, lab-verified); the live smoke test
 * (`test/telegram-live.test.ts`, LIVE_RPC=1) proves it answers on 31611.
 */
export const SORTED_TROVES_TESTNET = "0x722E4D24FD6Ff8b0AC679450F3D91294607268fA";
