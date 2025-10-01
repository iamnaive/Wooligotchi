// src/abi/erc721.ts
// Minimal ERC-721 ABI for transfer. Comments in English only.
export const ERC721_ABI = [
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "safeTransferFrom", stateMutability: "nonpayable", inputs: [
      { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "tokenId", type: "uint256" }
    ], outputs: [] },
] as const;
