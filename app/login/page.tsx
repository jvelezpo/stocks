import Link from "next/link";
import { LoginForm } from "../../components/LoginForm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type LoginPageProps = {
  searchParams: Promise<{ next?: string | string[] }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const resolved = await searchParams;
  const rawNext = Array.isArray(resolved.next) ? resolved.next[0] : resolved.next;
  const nextPath = rawNext && rawNext.startsWith("/") ? rawNext : "/";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-100 px-4 py-10">
      <div className="mb-6 text-center">
        <Link className="text-sm font-medium text-zinc-600 hover:text-zinc-950" href="/">
          ← Back to Signal Desk
        </Link>
      </div>
      <LoginForm nextPath={nextPath} />
      <p className="mt-4 max-w-md text-center text-xs leading-5 text-zinc-500">
        Roles: <span className="font-medium">admin</span> manages users,{" "}
        <span className="font-medium">user</span> is the default for new sign-ins,{" "}
        <span className="font-medium">guest</span> is limited access assigned by an admin.
      </p>
    </main>
  );
}
