"use client";

import { useEffect, useState } from "react";

/** Ledger-style "now": Unix epoch seconds, matching the contract's clock. */
export function useNowSeconds(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const id = setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      intervalMs
    );
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
