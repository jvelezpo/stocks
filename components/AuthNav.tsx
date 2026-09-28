"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type CurrentUser = {
  id: string;
  email: string;
  role: "admin" | "user" | "guest";
};

export const AUTH_CHANGED_EVENT = "stocks:auth-changed";

export function dispatchAuthChanged(user: CurrentUser | null) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<CurrentUser | null>(AUTH_CHANGED_EVENT, { detail: user }));
  }
}

export function AuthNav() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<CurrentUser | null | undefined>(undefined);

  const fetchUser = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const data = (await res.json()) as { user?: CurrentUser | null };
      setUser(data.user ?? null);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    const handleAuthChanged = (event: Event) => {
      const custom = event as CustomEvent<CurrentUser | null>;
      // Optimistic update when the new user is provided (login/logout),
      // otherwise re-fetch (e.g. role changed elsewhere).
      if (custom.detail !== undefined) {
        setUser(custom.detail);
      } else {
        void fetchUser();
      }
    };

    window.addEventListener(AUTH_CHANGED_EVENT, handleAuthChanged);
    return () => {
      window.removeEventListener(AUTH_CHANGED_EVENT, handleAuthChanged);
    };
  }, [fetchUser]);

  // Layout persists across client-side navigation, so re-validate the
  // session whenever the route changes (e.g. /login -> / after OTP).
  useEffect(() => {
    void fetchUser();
  }, [pathname, fetchUser]);

  const handleLogout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    dispatchAuthChanged(null);
    router.push("/");
    router.refresh();
  }, [router]);

  if (user === undefined) {
    return <span className="text-sm text-zinc-400">…</span>;
  }

  if (user === null) {
    return (
      <Link
        className="rounded-md bg-white px-3 py-2 text-sm font-medium text-zinc-950 transition hover:bg-zinc-200"
        href="/login"
      >
        Sign in
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      {user.role === "admin" ? (
        <>
          <Link
            className="rounded-md border border-white/20 px-3 py-2 font-medium text-white transition hover:border-white/40"
            href="/admin/users"
          >
            Users
          </Link>
          <Link
            className="rounded-md border border-white/20 px-3 py-2 font-medium text-white transition hover:border-white/40"
            href="/admin/symbols"
          >
            Symbols
          </Link>
        </>
      ) : null}
      <span className="hidden max-w-48 truncate text-zinc-300 sm:inline" title={user.email}>
        {user.email}
      </span>
      <span className="rounded-md bg-white/10 px-2 py-1 text-xs font-medium text-zinc-200">
        {user.role}
      </span>
      <button
        className="rounded-md bg-white px-3 py-2 font-medium text-zinc-950 transition hover:bg-zinc-200"
        onClick={handleLogout}
        type="button"
      >
        Sign out
      </button>
    </div>
  );
}
