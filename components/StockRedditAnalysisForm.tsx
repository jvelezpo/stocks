"use client";

import { LoaderCircle, MessageSquareText } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

type StockRedditAnalysisFormProps = {
  symbol: string;
};

export function StockRedditAnalysisForm({ symbol }: StockRedditAnalysisFormProps) {
  const router = useRouter();
  const [instruction, setInstruction] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsRunning(true);
    setIsError(false);
    setMessage(`Reading Reddit and Polymarket, then analyzing ${symbol}…`);

    try {
      const response = await fetch(
        `/api/admin/stocks/${encodeURIComponent(symbol)}/reddit-analysis`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ instruction }),
        }
      );
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Could not run research analysis.");
      }

      setInstruction("");
      setMessage("Reddit + Polymarket analysis completed.");
      router.refresh();
    } catch (error: unknown) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : "Could not run research analysis.");
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <form
      className="rounded-lg border border-orange-200 bg-orange-50/50 p-5 shadow-soft"
      onSubmit={(event) => void handleSubmit(event)}
    >
      <div className="flex items-center gap-2 text-sm font-medium text-orange-800">
        <MessageSquareText className="h-4 w-4" />
        Admin research analysis
      </div>
      <h2 className="mt-2 text-2xl font-semibold text-zinc-950">
        Analyze current discussion and prediction markets for {symbol}
      </h2>
      <p className="mt-2 text-sm leading-6 text-zinc-600">
        Leave the question empty to ask whether current Reddit discussion and Polymarket
        odds support buying, holding, or selling {symbol}.
      </p>
      <label className="mt-4 block text-sm font-medium text-zinc-700" htmlFor="reddit-analysis-instruction">
        Analysis question or instructions (optional)
      </label>
      <textarea
        className="mt-1.5 min-h-28 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
        disabled={isRunning}
        id="reddit-analysis-instruction"
        maxLength={2000}
        onChange={(event) => setInstruction(event.target.value)}
        placeholder={`What should we understand about Reddit and Polymarket signals for ${symbol}?`}
        value={instruction}
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          className="inline-flex h-10 items-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-wait disabled:opacity-60"
          disabled={isRunning}
          type="submit"
        >
          {isRunning ? (
            <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
          ) : (
            <MessageSquareText aria-hidden="true" className="h-4 w-4" />
          )}
          {isRunning ? "Analyzing…" : "Run analysis"}
        </button>
        {message ? (
          <span
            aria-live="polite"
            className={`text-sm ${isError ? "text-red-700" : "text-zinc-600"}`}
            role="status"
          >
            {message}
          </span>
        ) : null}
      </div>
    </form>
  );
}
