import { createHash, randomBytes } from "node:crypto";

export type PkcePair = {
  verifier: string;
  challenge: string;
  method: "S256";
  state: string;
};

function base64url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

export async function createPkcePair(): Promise<PkcePair> {
  const verifier = base64url(randomBytes(64));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(32));
  return { verifier, challenge, method: "S256", state };
}
