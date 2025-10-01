// src/abi/erc165.ts
// Minimal ERC-165 interface check. Comments in English only.
export const ERC165_ABI = [
  {
    type: "function",
    name: "supportsInterface",
    stateMutability: "view",
    inputs: [{ name: "interfaceId", type: "bytes4" }],
    outputs: [{ type: "bool" }],
  },
] as const;

export const IFACE_ERC721  = "0x80ac58cd";
export const IFACE_ERC1155 = "0xd9b67a26";
