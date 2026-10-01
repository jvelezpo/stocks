export default function DashboardLoading() {
  return (
    <main className="min-h-screen" aria-label="Loading dashboard">
      <div className="bg-[#161615] px-5 py-12 sm:px-8 lg:px-10">
        <div className="mx-auto max-w-7xl animate-pulse">
          <div className="h-12 w-72 rounded bg-white/15" />
          <div className="mt-6 h-5 w-96 max-w-full rounded bg-white/10" />
        </div>
      </div>
      <div className="mx-auto grid max-w-7xl animate-pulse gap-4 px-5 py-8 sm:px-8 md:grid-cols-2 lg:px-10 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div className="h-64 rounded-lg border border-zinc-200 bg-white shadow-soft" key={index} />
        ))}
      </div>
    </main>
  );
}
