// Minimal ERC-1155 ABI for approvals and transfer. Comments in English only.
export const ERC1155_ABI = [
  { type: "function", name: "isApprovedForAll", stateMutability: "view", inputs: [{ name: "account", type: "address" }, { name: "operator", type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "setApprovalForAll", stateMutability: "nonpayable", inputs: [{ name: "operator", type: "address" }, { name: "approved", type: "bool" }], outputs: [] },
  { type: "function", name: "safeTransferFrom", stateMutability: "nonpayable", inputs: [
      { name: "from", type: "address" }, { name: "to", type: "address" },
      { name: "id", type: "uint256" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }
    ], outputs: [] },
  { type: "function", name: "safeBatchTransferFrom", stateMutability: "nonpayable", inputs: [
      { name: "from", type: "address" }, { name: "to", type: "address" },
      { name: "ids", type: "uint256[]" }, { name: "values", type: "uint256[]" }, { name: "data", type: "bytes" }
    ], outputs: [] },
] as const;
