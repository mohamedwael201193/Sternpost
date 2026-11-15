import { describe, it, expect } from "vitest";
import { deploymentFileAddresses, SORTED_TROVES_TESTNET } from "../src/deployments.js";
import { loadConfig } from "../src/config.js";

const PAY_TO = "0x1111111111111111111111111111111111111111" as const;

describe("deployments: shared/deployments/testnet.json is the address source", () => {
  it("loads the 0.9 Classic redeploy + Mezo contracts", () => {
    const a = deploymentFileAddresses();
    expect(a.factory).toBe("0x39779A8678424CF78c841F9AfEa1EAFF3Cf7F6d8");
    expect(a.governor).toBe("0x1bF45cFE654a397F4FF3B33bC1b157c88Ee71F38");
    expect(a.router).toBe("0xd6833f811e987f06a1e55a435d4be38c6d4188d4");
    expect(a.spendWallet).toBe("0x4F878203175B1BB6C63Ec02CEEBE1af4A7c9Ee4a");
    expect(a.musd).toBe("0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503");
    expect(a.troveManager).toBe("0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0");
    expect(a.priceFeed).toBe("0x86bCF0841622a5dAC14A313a15f96A95421b9366");
    expect(a.borrower).toBe("0xf76e6B0920e9332fF4410f6dD53F01722AbC71a3");
  });

  it("SortedTroves is the MEZO_RESOURCES-verified address (not in testnet.json)", () => {
    expect(SORTED_TROVES_TESTNET).toBe("0x722E4D24FD6Ff8b0AC679450F3D91294607268fA");
  });

  it("config defaults come from the file; an explicit env var still wins", () => {
    const c = loadConfig({ X402_PAY_TO: PAY_TO });
    expect(c.TROVE_MANAGER_ADDRESS).toBe("0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0");
    expect(c.PRICE_FEED_ADDRESS).toBe("0x86bCF0841622a5dAC14A313a15f96A95421b9366");
    expect(c.MUSD_ADDRESS).toBe("0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503");
    expect(c.SORTED_TROVES_ADDRESS).toBe(SORTED_TROVES_TESTNET);
    const over = loadConfig({ X402_PAY_TO: PAY_TO, TROVE_MANAGER_ADDRESS: "0x2222222222222222222222222222222222222222" });
    expect(over.TROVE_MANAGER_ADDRESS).toBe("0x2222222222222222222222222222222222222222");
  });
});
