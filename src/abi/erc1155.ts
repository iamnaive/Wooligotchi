// src/abi/erc1155.ts
// Minimal ERC-1155 ABI for transfer. Comments in English only.
export const ERC1155_ABI = [
  { type: "function", name: "safeTransferFrom", stateMutability: "nonpayable", inputs: [
      { name: "from", type: "address" }, { name: "to", type: "address" },
      { name: "id", type: "uint256" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }
    ], outputs: [] },
] as const;
