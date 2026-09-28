"use client";

import { useCallback, useEffect, useState } from "react";

type TrackedSymbol = {
  id: number;
  symbol: string;
  displayName: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type Draft = {
  symbol: string;
  displayName: string;
  isActive: boolean;
};

export function AdminSymbolsClient() {
  const [symbols, setSymbols] = useState<TrackedSymbol[]>([]);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<number | string | null>(null);

  const [newSymbol, setNewSymbol] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newActive, setNewActive] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/symbols", { cache: "no-store" });
      const data = (await response.json()) as { symbols?: TrackedSymbol[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not load symbols.");
      const list = data.symbols ?? [];
      setSymbols(list);
      setDrafts(
        Object.fromEntries(
          list.map((s) => [s.id, { symbol: s.symbol, displayName: s.displayName, isActive: s.isActive }])
        )
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load symbols.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function updateDraft(id: number, patch: Partial<Draft>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function isDirty(s: TrackedSymbol): boolean {
    const d = drafts[s.id];
    if (!d) return false;
    return d.symbol !== s.symbol || d.displayName !== s.displayName || d.isActive !== s.isActive;
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setSavingId("new");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/symbols", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: newSymbol, displayName: newDisplayName, isActive: newActive }),
      });
      const data = (await response.json()) as { error?: string; symbol?: TrackedSymbol };
      if (!response.ok) throw new Error(data.error ?? "Could not add symbol.");
      setNewSymbol("");
      setNewDisplayName("");
      setNewActive(true);
      setNotice(`Added ${data.symbol?.symbol ?? newSymbol.trim().toUpperCase()}. Collector will pick it up on its next run.`);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not add symbol.");
    } finally {
      setSavingId(null);
    }
  }

  async function handleSave(s: TrackedSymbol) {
    const draft = drafts[s.id];
    if (!draft) return;
    setSavingId(s.id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/symbols", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: s.id,
          symbol: draft.symbol,
          displayName: draft.displayName,
          isActive: draft.isActive,
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not update symbol.");
      setNotice(`Saved ${draft.symbol.trim().toUpperCase() || s.symbol}.`);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not update symbol.");
    } finally {
      setSavingId(null);
    }
  }

  async function handleToggleActive(s: TrackedSymbol, isActive: boolean) {
    updateDraft(s.id, { isActive });
    setSavingId(s.id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/symbols", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: s.id, isActive }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not update symbol.");
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not update symbol.");
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(s: TrackedSymbol) {
    if (!window.confirm(`Remove ${s.symbol} from tracking? Collected history is kept.`)) return;
    setSavingId(s.id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/symbols?id=${encodeURIComponent(String(s.id))}`, {
        method: "DELETE",
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not delete symbol.");
      setNotice(`Removed ${s.symbol}.`);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not delete symbol.");
    } finally {
      setSavingId(null);
    }
  }

  if (loading) {
    return <p className="text-sm text-zinc-600">Loading symbols…</p>;
  }

  return (
    <div>
      {error ? (
        <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}
      {notice ? (
        <p className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 ring-1 ring-emerald-200">
          {notice}
        </p>
      ) : null}

      <form
        className="mb-6 rounded-lg border border-zinc-200 bg-white p-4 shadow-soft"
        onSubmit={handleCreate}
      >
        <h2 className="text-sm font-semibold text-zinc-950">Add symbol</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-zinc-700">Symbol</span>
            <input
              className="h-10 w-full rounded-md border border-zinc-200 px-3 uppercase outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
              onChange={(event) => setNewSymbol(event.target.value.toUpperCase())}
              placeholder="NVDA"
              required
              value={newSymbol}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-zinc-700">Display name (optional)</span>
            <input
              className="h-10 w-full rounded-md border border-zinc-200 px-3 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
              onChange={(event) => setNewDisplayName(event.target.value)}
              placeholder="NVIDIA Corp."
              value={newDisplayName}
            />
          </label>
          <div className="flex items-end gap-3">
            <label className="flex h-10 items-center gap-2 text-sm text-zinc-700">
              <input
                checked={newActive}
                onChange={(event) => setNewActive(event.target.checked)}
                type="checkbox"
              />
              Active
            </label>
            <button
              className="h-10 rounded-md bg-zinc-950 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-50"
              disabled={savingId === "new" || !newSymbol.trim()}
              type="submit"
            >
              {savingId === "new" ? "Adding…" : "Add"}
            </button>
          </div>
        </div>
      </form>

      <div className="overflow-hidden rounded-lg border border-zinc-200">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-200 text-left text-sm">
            <thead className="bg-zinc-50 text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-medium">Symbol</th>
                <th className="px-4 py-3 font-medium">Display name</th>
                <th className="px-4 py-3 font-medium">Active</th>
                <th className="px-4 py-3 font-medium">Updated</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 bg-white">
              {symbols.map((s) => {
                const draft = drafts[s.id] ?? {
                  symbol: s.symbol,
                  displayName: s.displayName,
                  isActive: s.isActive,
                };
                const dirty = isDirty(s);
                const busy = savingId === s.id;
                return (
                  <tr className="hover:bg-zinc-50" key={s.id}>
                    <td className="whitespace-nowrap px-4 py-3">
                      <input
                        className="h-9 w-32 rounded-md border border-zinc-200 px-2 font-semibold uppercase text-zinc-950 outline-none focus:border-emerald-500"
                        onChange={(event) =>
                          updateDraft(s.id, { symbol: event.target.value.toUpperCase() })
                        }
                        value={draft.symbol}
                      />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <input
                        className="h-9 w-48 rounded-md border border-zinc-200 px-2 text-zinc-800 outline-none focus:border-emerald-500"
                        onChange={(event) => updateDraft(s.id, { displayName: event.target.value })}
                        placeholder="—"
                        value={draft.displayName}
                      />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <button
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${draft.isActive ? "bg-emerald-500" : "bg-zinc-300"}`}
                        disabled={busy}
                        onClick={() => handleToggleActive(s, !draft.isActive)}
                        role="switch"
                        aria-checked={draft.isActive}
                        title={draft.isActive ? "Deactivate" : "Activate"}
                        type="button"
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${draft.isActive ? "translate-x-6" : "translate-x-1"}`}
                        />
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-zinc-600">
                      {s.updatedAt ? new Date(s.updatedAt).toLocaleString() : "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex gap-2">
                        <button
                          className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:border-zinc-300 hover:text-zinc-950 disabled:opacity-50"
                          disabled={!dirty || busy}
                          onClick={() => handleSave(s)}
                          type="button"
                        >
                          {busy ? "Saving…" : "Save"}
                        </button>
                        <button
                          className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 transition hover:border-red-300 hover:bg-red-50 disabled:opacity-50"
                          disabled={busy}
                          onClick={() => handleDelete(s)}
                          type="button"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {symbols.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-center text-zinc-500" colSpan={5}>
                    No symbols tracked yet. Add your first symbol above.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
      <p className="mt-3 text-xs leading-5 text-zinc-500">
        Only active symbols are collected by the background job. Deleting a symbol stops
        future collection but keeps its stored history, documents, and analyses.
      </p>
    </div>
  );
}
