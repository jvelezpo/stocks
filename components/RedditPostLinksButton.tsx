"use client";

import { ExternalLink, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { RedditStockMentionPost } from "../lib/reddit";

type RedditPostLinksButtonProps = {
  posts: RedditStockMentionPost[];
  symbol: string;
};

export function RedditPostLinksButton({
  posts,
  symbol,
}: RedditPostLinksButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  function closeModal(): void {
    setIsOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const handleEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") {
        closeModal();
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleEscape);
    window.requestAnimationFrame(() => dialogRef.current?.focus());

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  const postLabel = `${posts.length} ${posts.length === 1 ? "post" : "posts"}`;

  return (
    <>
      <button
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className="shrink-0 rounded-md bg-white px-2 py-1 text-xs font-medium text-zinc-600 ring-1 ring-zinc-200 transition hover:bg-zinc-100 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
        onClick={() => setIsOpen(true)}
        ref={triggerRef}
        type="button"
      >
        {postLabel}
      </button>

      {isOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/50 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeModal();
            }
          }}
        >
          <div
            aria-labelledby={titleId}
            aria-modal="true"
            className="max-h-[min(40rem,calc(100dvh-2rem))] w-full max-w-xl overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-2xl focus:outline-none"
            ref={dialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <header className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-zinc-950" id={titleId}>
                  {symbol} Reddit posts
                </h2>
                <p className="mt-1 text-sm text-zinc-500">
                  {postLabel} matched this list
                </p>
              </div>
              <button
                aria-label="Close Reddit posts"
                className="rounded-md p-2 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                onClick={closeModal}
                type="button"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </header>

            <ol className="max-h-[calc(100dvh-10rem)] space-y-2 overflow-y-auto p-5">
              {posts.map((post, index) => (
                <li key={post.url}>
                  <a
                    className="flex items-start gap-3 rounded-lg border border-zinc-200 p-4 text-sm text-zinc-800 transition hover:border-zinc-300 hover:bg-zinc-50 hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                    href={post.url}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    <span className="mt-0.5 text-xs font-medium text-zinc-400">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 font-medium leading-5">
                      {post.title}
                    </span>
                    <ExternalLink
                      aria-hidden="true"
                      className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400"
                    />
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </div>
      ) : null}
    </>
  );
}
