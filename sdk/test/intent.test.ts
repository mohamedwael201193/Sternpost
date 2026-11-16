import { describe, it, expect } from "vitest";
import { hashTypedData, keccak256, toHex, encodeAbiParameters, recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { signIntent, intentDigest } from "../src/intent.js";
import { accountDomain, drawIntentTypes } from "../src/typed.js";
import type { Address } from "viem";

// Public anvil test vectors (valueless); the agent key in the repo's typed.test.ts.
const AGENT_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const agent = privateKeyToAccount(AGENT_KEY);
const ACCOUNT = "0x02Dda72b052fe7b28214C09743d6Ed0DE813F0B8" as Address; // Shield-redeploy implementation (domain check only)
const PAYEE = "0xC3376296a18ef364eA19287203EEd7a87f18e738" as Address; // demo.vativ.io payTo
const CHAIN_ID = 31611;

// Recompute exactly the way TroveAccount.intentDigest does in Solidity:
// keccak256(0x1901 || domainSeparator || keccak256(abi.encode(INTENT_TYPEHASH, agent, payee, amount, nonce, deadline))).
const solDigest = (agentAddr: Address, payee: Address, amount: bigint, nonce: bigint, deadline: bigint) => {
  const ds = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
      [
        keccak256(toHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")),
        keccak256(toHex("SternpostTroveAccount")),
        keccak256(toHex("1")),
        31611n,
        ACCOUNT,
      ],
    ),
  );
  const sh = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
      [
        keccak256(toHex("DrawIntent(address agent,address payee,uint256 amount,uint256 nonce,uint256 deadline)")),
        agentAddr,
        payee,
        amount,
        nonce,
        deadline,
      ],
    ),
  );
  return keccak256(`0x1901${ds.slice(2)}${sh.slice(2)}`);
};

describe("DrawIntent EIP-712", () => {
  it("intentDigest matches the contract's intentDigest formula byte for byte", () => {
    expect(intentDigest(CHAIN_ID, ACCOUNT, agent.address, PAYEE, 1_000_000_000_000_000n, 7n, 99n)).toBe(
      solDigest(agent.address, PAYEE, 1_000_000_000_000_000n, 7n, 99n),
    );
  });

  it("intentDigest matches viem hashTypedData under the production domain", () => {
    const args = {
      domain: accountDomain(CHAIN_ID, ACCOUNT),
      types: drawIntentTypes,
      primaryType: "DrawIntent" as const,
      message: { agent: agent.address, payee: PAYEE, amount: 1_000_000_000_000_000n, nonce: 7n, deadline: 99n },
    };
    expect(intentDigest(CHAIN_ID, ACCOUNT, agent.address, PAYEE, 1_000_000_000_000_000n, 7n, 99n)).toBe(
      hashTypedData(args),
    );
  });

  it("the production domain name is SternpostTroveAccount, not the lab's TroveAccountV3", () => {
    expect(accountDomain(CHAIN_ID, ACCOUNT).name).toBe("SternpostTroveAccount");
    // The lab name gives a different digest: a V3-domain signature must
    // never verify against a production account.
    const lab = hashTypedData({
      domain: { name: "TroveAccountV3", version: "1", chainId: CHAIN_ID, verifyingContract: ACCOUNT },
      types: drawIntentTypes,
      primaryType: "DrawIntent",
      message: { agent: agent.address, payee: PAYEE, amount: 1n, nonce: 0n, deadline: 1n },
    });
    expect(lab).not.toBe(intentDigest(CHAIN_ID, ACCOUNT, agent.address, PAYEE, 1n, 0n, 1n));
  });

  it("signIntent reads the nonce, signs, and recovers to the agent", async () => {
    const before = Math.floor(Date.now() / 1000);
    const intent = await signIntent({
      chainId: CHAIN_ID,
      account: ACCOUNT,
      agent: agent as never,
      payee: PAYEE,
      amount: 1_000_000_000_000_000n,
      readNonce: async () => 7n,
      deadlineSec: 120,
    });
    expect(intent.agent).toBe(agent.address);
    expect(intent.payee).toBe(PAYEE);
    expect(intent.amount).toBe(1_000_000_000_000_000n);
    expect(intent.nonce).toBe(7n);
    expect(intent.deadline).toBeGreaterThanOrEqual(BigInt(before + 120));
    expect(intent.deadline).toBeLessThanOrEqual(BigInt(before + 121));
    expect(
      await recoverTypedDataAddress({
        domain: accountDomain(CHAIN_ID, ACCOUNT),
        types: drawIntentTypes,
        primaryType: "DrawIntent",
        message: { agent: intent.agent, payee: intent.payee, amount: intent.amount, nonce: intent.nonce, deadline: intent.deadline },
        signature: intent.sig,
      }),
    ).toBe(agent.address);
  });

  it("signIntent defaults to a 120 s deadline", async () => {
    const before = Math.floor(Date.now() / 1000);
    const intent = await signIntent({
      chainId: CHAIN_ID,
      account: ACCOUNT,
      agent: agent as never,
      payee: PAYEE,
      amount: 1n,
      readNonce: async () => 0n,
    });
    expect(intent.deadline).toBeGreaterThanOrEqual(BigInt(before + 120));
    expect(intent.deadline).toBeLessThanOrEqual(BigInt(before + 121));
  });
});
