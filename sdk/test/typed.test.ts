import { describe, it, expect } from "vitest";
import { hashTypedData, keccak256, toHex, encodeAbiParameters, recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { domain, withdrawTypes, repayTypes, addCollTypes } from "../src/typed.js";

const SIG = "0xD757e3646AF370b15f32EB557F0F8380Df7D639e" as const;
const acct = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const borrower = acct.address;

// Recompute exactly the way SternpostGovernor / BorrowerOperationsSignatures do in Solidity.
const solDigest = (typeString: string, values: { type: string; v: unknown }[]) => {
  const ds = keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
    [keccak256(toHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")),
     keccak256(toHex("BorrowerOperationsSignatures")), keccak256(toHex("1")), 31611n, SIG]));
  const sh = keccak256(encodeAbiParameters([{ type: "bytes32" }, ...values.map((x) => ({ type: x.type }))],
    [keccak256(toHex(typeString)), ...values.map((x) => x.v)] as never));
  return keccak256(`0x1901${ds.slice(2)}${sh.slice(2)}`);
};

describe("EIP-712 parity with Mezo", () => {
  it("WithdrawMUSD", () => {
    const m = { amount: 5n, borrower, recipient: SIG, nonce: 7n, deadline: 99n };
    expect(hashTypedData({ domain: domain(31611, SIG), types: withdrawTypes, primaryType: "WithdrawMUSD", message: m }))
      .toBe(solDigest("WithdrawMUSD(uint256 amount,address borrower,address recipient,uint256 nonce,uint256 deadline)",
        [{ type: "uint256", v: 5n }, { type: "address", v: borrower }, { type: "address", v: SIG }, { type: "uint256", v: 7n }, { type: "uint256", v: 99n }]));
  });
  it("RepayMUSD", () => {
    const m = { amount: 5n, borrower, nonce: 8n, deadline: 99n };
    expect(hashTypedData({ domain: domain(31611, SIG), types: repayTypes, primaryType: "RepayMUSD", message: m }))
      .toBe(solDigest("RepayMUSD(uint256 amount,address borrower,uint256 nonce,uint256 deadline)",
        [{ type: "uint256", v: 5n }, { type: "address", v: borrower }, { type: "uint256", v: 8n }, { type: "uint256", v: 99n }]));
  });
  it("AddColl (nonce burn)", () => {
    const m = { assetAmount: 1n, borrower, nonce: 3n, deadline: 99n };
    expect(hashTypedData({ domain: domain(31611, SIG), types: addCollTypes, primaryType: "AddColl", message: m }))
      .toBe(solDigest("AddColl(uint256 assetAmount,address borrower,uint256 nonce,uint256 deadline)",
        [{ type: "uint256", v: 1n }, { type: "address", v: borrower }, { type: "uint256", v: 3n }, { type: "uint256", v: 99n }]));
  });
  it("signature recovers to the borrower", async () => {
    const args = { domain: domain(31611, SIG), types: repayTypes, primaryType: "RepayMUSD" as const, message: { amount: 1n, borrower, nonce: 0n, deadline: 1n } };
    const sig = await acct.signTypedData(args);
    expect(await recoverTypedDataAddress({ ...args, signature: sig })).toBe(borrower);
  });
});
