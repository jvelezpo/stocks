"use client";

import { useCallback, useEffect, useState } from "react";

type AdminUser = {
  id: string;
  email: string;
  role: "admin" | "user" | "guest";
  createdAt: string;
  lastLoginAt: string;
  isActive: boolean;
};

const ROLES: Array<AdminUser["role"]> = ["admin", "user", "guest"];

export function AdminUsersClient() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/users", { cache: "no-store" });
      const data = (await response.json()) as { users?: AdminUser[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not load users.");
      setUsers(data.users ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load users.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRoleChange(userId: string, role: AdminUser["role"]) {
    setSavingId(userId);
    setError(null);
    try {
      const response = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, role }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not update role.");
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not update role.");
    } finally {
      setSavingId(null);
    }
  }

  if (loading) {
    return <p className="text-sm text-zinc-600">Loading users…</p>;
  }

  return (
    <div>
      {error ? (
        <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}
      <div className="overflow-hidden rounded-lg border border-zinc-200">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-200 text-left text-sm">
            <thead className="bg-zinc-50 text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium">Last login</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 bg-white">
              {users.map((user) => (
                <tr className="hover:bg-zinc-50" key={user.id}>
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-zinc-950">
                    {user.email}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <select
                      className="h-9 rounded-md border border-zinc-200 bg-white px-2 text-sm outline-none focus:border-emerald-500"
                      disabled={savingId === user.id}
                      onChange={(event) =>
                        handleRoleChange(user.id, event.target.value as AdminUser["role"])
                      }
                      value={user.role}
                    >
                      {ROLES.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-zinc-600">
                    {user.createdAt ? new Date(user.createdAt).toLocaleString() : "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-zinc-600">
                    {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
              {users.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-center text-zinc-500" colSpan={4}>
                    No users yet. Users are created automatically on first OTP login.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
