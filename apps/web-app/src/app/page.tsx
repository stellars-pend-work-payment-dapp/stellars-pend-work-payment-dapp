import { redirect } from "next/navigation";

/**
 * The product is the job board: a client creates a job, escrows the payment in
 * a Soroban contract, a worker delivers, and the contract releases the money on
 * approval. Everything else in the app is reachable from there.
 */
export default function Home() {
  redirect("/jobs");
}
