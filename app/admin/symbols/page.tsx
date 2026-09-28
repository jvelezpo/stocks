import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySessionToken, hasRole, SESSION_COOKIE_NAME } from "../../../lib/auth.ts";
import { AdminSymbolsClient } from "../../../components/AdminSymbolsClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AdminSymbolsPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (!session) {
    redirect("/login?next=/admin/symbols");
  }
  if (!hasRole(session.user.role, "admin")) {
    redirect("/login?next=/admin/symbols");
  }

  return (
    <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-950">Symbol management</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Signed in as {session.user.email} ({session.user.role}). These symbols drive
            the quote collector — no <code className="rounded bg-zinc-100 px-1">.env</code> edit needed.
          </p>
        </div>
        <Link className="text-sm font-medium text-zinc-600 hover:text-zinc-950" href="/">
          ← Dashboard
        </Link>
      </div>
      <div className="mb-6 flex gap-2 text-sm">
        <Link
          className="rounded-md border border-zinc-200 px-3 py-2 font-medium text-zinc-600 transition hover:text-zinc-950"
          href="/admin/users"
        >
          Users
        </Link>
        <span className="rounded-md bg-zinc-950 px-3 py-2 font-medium text-white">Symbols</span>
      </div>
      <AdminSymbolsClient />
    </main>
  );
}
