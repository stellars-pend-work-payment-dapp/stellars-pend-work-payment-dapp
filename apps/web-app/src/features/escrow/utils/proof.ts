/**
 * Proof-of-delivery helpers.
 *
 * The contract stores a 32-byte SHA-256 commitment, not the deliverable itself.
 * Workers paste a reference to what they delivered (a commit URL, an IPFS CID,
 * a document link) and the app hashes it, so the on-chain record is small,
 * bounded, and tamper-evident: the same reference always produces the same hash.
 */

/** SHA-256 of a UTF-8 string, as 32 raw bytes. */
export async function sha256Bytes(input: string): Promise<Uint8Array> {
  // Copied into a fresh, non-shared buffer so the value satisfies
  // `BufferSource` under TypeScript's stricter typed-array generics.
  const bytes = new Uint8Array(new TextEncoder().encode(input));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(digest);
}

/** Lowercase hex rendering, for display. */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Whether a deliverable reference is long enough to be meaningful. */
export function isUsableProofReference(reference: string): boolean {
  return reference.trim().length >= 8;
}
