export default function StockLoading() {
  return (
    <main className="min-h-screen" aria-label="Loading stock">
      <div className="bg-[#161615] px-5 py-12 sm:px-8 lg:px-10">
        <div className="mx-auto max-w-7xl animate-pulse">
          <div className="h-10 w-28 rounded bg-white/15" />
          <div className="mt-8 h-16 w-52 rounded bg-white/15" />
          <div className="mt-4 h-5 w-80 max-w-full rounded bg-white/10" />
        </div>
      </div>
      <div className="mx-auto max-w-7xl animate-pulse space-y-5 px-5 py-8 sm:px-8 lg:px-10">
        <div className="h-48 rounded-lg border border-zinc-200 bg-white shadow-soft" />
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="h-72 rounded-lg border border-zinc-200 bg-white shadow-soft" />
          <div className="h-72 rounded-lg border border-zinc-200 bg-white shadow-soft" />
        </div>
      </div>
    </main>
  );
}
