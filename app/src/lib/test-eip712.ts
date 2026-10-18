/** Tiny EIP-712 encodeType for tests (single struct, no nested types). */
export const encodeType = (name: string, fields: readonly { name: string; type: string }[]) =>
  `${name}(${fields.map((f) => `${f.type} ${f.name}`).join(',')})`
