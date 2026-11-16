import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { testnetAddresses } from "../src/chain.js";

/**
 * F1 (0.9/J3): the SDK once defaulted to the superseded Wave-1 factory
 * (0x0632A9FeA303c0dB4544BF642a8aD0467C6c6980) while the redeployed factory
 * lived in shared/deployments/testnet.json. Any consumer using SDK defaults
 * would have created a Wave-1 governor carrying the defects 0.9 exists to
 * eliminate. This test pins the SDK defaults to the deployment record so a
 * future redeploy that forgets the SDK fails loudly here instead of
 * silently pointing at a superseded contract.
 */
const deployment = JSON.parse(
  readFileSync(new URL("../../shared/deployments/testnet.json", import.meta.url), "utf8"),
) as {
  sternpost: { SternpostFactory: { address: string } };
  mezo: {
    BorrowerOperationsSignatures: string;
    BorrowerOperations: string;
    TroveManager: string;
    PriceFeed: string;
    MUSD: string;
    sMUSD: string;
    Permit2: string;
  };
  accounts: {
    implementation: { address: string };
    factory: { address: string };
    radar: { address: string };
    batcher: { address: string };
  };
};

describe("SDK default addresses match the deployment record", () => {
  it("factory is the redeployed (0.9) factory, not the superseded Wave-1 one", () => {
    expect(testnetAddresses.factory.toLowerCase()).toBe(
      deployment.sternpost.SternpostFactory.address.toLowerCase(),
    );
    expect(testnetAddresses.factory.toLowerCase()).not.toBe(
      "0x0632a9fea303c0db4544bf642a8ad0467c6c6980",
    );
  });

  it("Mezo addresses match the deployment record", () => {
    expect(testnetAddresses.signatures.toLowerCase()).toBe(
      deployment.mezo.BorrowerOperationsSignatures.toLowerCase(),
    );
    expect(testnetAddresses.troveManager.toLowerCase()).toBe(
      deployment.mezo.TroveManager.toLowerCase(),
    );
    expect(testnetAddresses.priceFeed.toLowerCase()).toBe(
      deployment.mezo.PriceFeed.toLowerCase(),
    );
    expect(testnetAddresses.musd.toLowerCase()).toBe(deployment.mezo.MUSD.toLowerCase());
    expect(testnetAddresses.smusd.toLowerCase()).toBe(deployment.mezo.sMUSD.toLowerCase());
    expect(testnetAddresses.permit2.toLowerCase()).toBe(deployment.mezo.Permit2.toLowerCase());
  });

  it("account (2.2) addresses match the Shield-redeploy record in testnet.json accounts.*", () => {
    expect(testnetAddresses.accountImplementation.toLowerCase()).toBe(
      deployment.accounts.implementation.address.toLowerCase(),
    );
    expect(testnetAddresses.accountFactory.toLowerCase()).toBe(
      deployment.accounts.factory.address.toLowerCase(),
    );
    expect(testnetAddresses.accountRadar.toLowerCase()).toBe(
      deployment.accounts.radar.address.toLowerCase(),
    );
    expect(testnetAddresses.accountBatcher.toLowerCase()).toBe(
      deployment.accounts.batcher.address.toLowerCase(),
    );
    // Not the superseded 1.9 (pre-Shield) deployment.
    expect(testnetAddresses.accountImplementation.toLowerCase()).not.toBe(
      "0xc4f080498a720887b6086f13fbad5627d8abc470",
    );
    expect(testnetAddresses.accountFactory.toLowerCase()).not.toBe(
      "0xfb4efe7953af18dbcaa1124da721cd3fb8fd85c3",
    );
  });

  it("hint contracts match the on-chain values (not in testnet.json)", () => {
    // sortedTroves: read live from the deployed implementation's
    // sortedTroves() view (verified 2026-11-16).
    // hintHelpers: the Mezo-documented testnet address in the repo's own
    // contracts/src/account/interfaces/IHintHelpers.sol; verified live
    // 2026-11-16 — computeNominalCR(0.05e18, 2016.2187e18) returns
    // 2479889706409329, exactly coll*1e20/debt. The implementation has no
    // hintHelpers() getter (hints are computed off-chain, not on-chain).
    expect(testnetAddresses.sortedTroves.toLowerCase()).toBe("0x722e4d24fd6ff8b0ac679450f3d91294607268fa");
    expect(testnetAddresses.hintHelpers.toLowerCase()).toBe("0x4e4cba3779d56386ed43631b4dcd6d8eacecbcf6");
    expect(testnetAddresses.borrowerOperations.toLowerCase()).toBe(
      deployment.mezo.BorrowerOperations.toLowerCase(),
    );
  });
});
