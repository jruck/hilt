export function stableId(input: string): string {
  let hash = BigInt("14695981039346656037");
  const prime = BigInt("1099511628211");
  for (const byte of Buffer.from(input)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16);
}
