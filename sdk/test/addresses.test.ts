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
    TroveManager: string;
    PriceFeed: string;
    MUSD: string;
    sMUSD: string;
    Permit2: string;
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
});
