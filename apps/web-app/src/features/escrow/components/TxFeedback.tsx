"use client";

import { explorerTxUrl } from "../constants";
import { Notice, Spinner } from "./ui";

/**
 * Renders the three states of an asynchronous escrow action.
 *
 * A hash is only shown once the network has accepted the transaction, so the
 * link is always checkable. Errors surface the translated contract/wallet
 * message rather than a generic failure.
 */
export function TxFeedback({
  pending,
  error,
  receipt,
  onDismiss,
}: {
  pending: string | null;
  error: string | null;
  receipt: { action: string; hash: string } | null;
  onDismiss?: () => void;
}) {
  if (!pending && !error && !receipt) return null;

  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      {pending ? (
        <Notice tone="info">
          <span className="flex items-center gap-2">
            <Spinner />
            <span>
              {pending} — confirm the transaction in your wallet, then wait for
              the network to include it.
            </span>
          </span>
        </Notice>
      ) : null}

      {error ? (
        <Notice tone="error">
          <div className="flex items-start justify-between gap-3">
            <span>{error}</span>
            {onDismiss ? (
              <button
                type="button"
                onClick={onDismiss}
                className="cursor-pointer text-xs font-semibold underline"
              >
                Dismiss
              </button>
            ) : null}
          </div>
        </Notice>
      ) : null}

      {receipt && !error ? (
        <Notice tone="success">
          <div className="flex items-start justify-between gap-3">
            <span className="flex flex-col gap-1">
              <span className="font-semibold">{receipt.action} confirmed</span>
              {receipt.hash ? (
                <a
                  href={explorerTxUrl(receipt.hash)}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all underline"
                >
                  {receipt.hash}
                </a>
              ) : (
                <span className="break-all opacity-80">
                  Transaction submitted.
                </span>
              )}
            </span>
            {onDismiss ? (
              <button
                type="button"
                onClick={onDismiss}
                className="cursor-pointer text-xs font-semibold underline"
              >
                Dismiss
              </button>
            ) : null}
          </div>
        </Notice>
      ) : null}
    </div>
  );
}
