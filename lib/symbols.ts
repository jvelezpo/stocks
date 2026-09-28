import { ensureStockSchema, turso } from "./turso.ts";

export type TrackedSymbol = {
  id: number;
  symbol: string;
  displayName: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type TrackedSymbolRow = {
  id: number;
  symbol: string;
  display_name: string;
  is_active: number;
  created_at: string;
  updated_at: string;
};

const SYMBOL_PATTERN = /^[A-Z0-9.\-^=/]{1,20}$/;

export function normalizeSymbol(value: unknown): string {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (!normalized) {
    throw new Error("Symbol is required.");
  }
  if (!SYMBOL_PATTERN.test(normalized)) {
    throw new Error(
      "Invalid symbol. Use 1-20 characters: letters, numbers, and . - ^ = / (e.g. NVDA, BRK.B, VWRA.L)."
    );
  }
  return normalized;
}

export function parseSymbolsValue(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  let parts: string[];
  if (trimmed.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      throw new Error('SYMBOLS must be a comma-separated list or a JSON array like ["IONQ","NVDA"].');
    }
    if (!Array.isArray(parsed) || parsed.some((s) => typeof s !== "string")) {
      throw new Error("SYMBOLS JSON value must be an array of strings.");
    }
    parts = parsed as string[];
  } else {
    parts = trimmed.split(",");
  }
  const unique = new Set<string>();
  for (const part of parts) {
    const candidate = part.trim().toUpperCase();
    if (!candidate) continue;
    // Skip invalid entries during bulk parse; strict validation happens on CRUD.
    if (SYMBOL_PATTERN.test(candidate)) unique.add(candidate);
  }
  return Array.from(unique);
}

function parseEnvSymbols(): string[] {
  const raw = process.env.SYMBOLS?.trim() ?? "";
  if (!raw) return [];
  return parseSymbolsValue(raw);
}

function mapRow(row: TrackedSymbolRow): TrackedSymbol {
  return {
    id: Number(row.id),
    symbol: String(row.symbol),
    displayName: String(row.display_name ?? ""),
    isActive: Number(row.is_active) === 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function listTrackedSymbols(activeOnly = false): Promise<TrackedSymbol[]> {
  await ensureStockSchema();
  const result = activeOnly
    ? await turso.execute(
        "SELECT id, symbol, display_name, is_active, created_at, updated_at FROM tracked_symbols WHERE is_active = 1 ORDER BY symbol ASC"
      )
    : await turso.execute(
        "SELECT id, symbol, display_name, is_active, created_at, updated_at FROM tracked_symbols ORDER BY symbol ASC"
      );
  return (result.rows as unknown as TrackedSymbolRow[]).map(mapRow);
}

export async function listActiveSymbols(): Promise<string[]> {
  const symbols = await listTrackedSymbols(true);
  return symbols.map((s) => s.symbol);
}

export async function countTrackedSymbols(): Promise<number> {
  await ensureStockSchema();
  const result = await turso.execute("SELECT COUNT(*) AS count FROM tracked_symbols");
  return Number(result.rows[0]?.count ?? 0);
}

export async function createTrackedSymbol(input: {
  symbol: unknown;
  displayName?: unknown;
  isActive?: unknown;
}): Promise<TrackedSymbol> {
  const symbol = normalizeSymbol(input.symbol);
  const displayName = String(input.displayName ?? "").trim().slice(0, 120);
  const isActive = input.isActive === undefined ? true : Boolean(input.isActive);
  const now = new Date().toISOString();

  await ensureStockSchema();
  try {
    await turso.execute({
      sql: "INSERT INTO tracked_symbols (symbol, display_name, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      args: [symbol, displayName, isActive ? 1 : 0, now, now],
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("UNIQUE") || message.includes("unique")) {
      throw new Error(`Symbol ${symbol} is already tracked.`);
    }
    throw error;
  }

  const created = await turso.execute({
    sql: "SELECT id, symbol, display_name, is_active, created_at, updated_at FROM tracked_symbols WHERE symbol = ? LIMIT 1",
    args: [symbol],
  });
  if (created.rows.length === 0) throw new Error("Could not create symbol.");
  return mapRow(created.rows[0] as unknown as TrackedSymbolRow);
}

export async function updateTrackedSymbol(
  id: unknown,
  input: { symbol?: unknown; displayName?: unknown; isActive?: unknown }
): Promise<TrackedSymbol> {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    throw new Error("Valid symbol id is required.");
  }

  await ensureStockSchema();
  const existing = await turso.execute({
    sql: "SELECT id, symbol, display_name, is_active, created_at, updated_at FROM tracked_symbols WHERE id = ? LIMIT 1",
    args: [numericId],
  });
  if (existing.rows.length === 0) {
    throw new Error("Symbol not found.");
  }
  const current = mapRow(existing.rows[0] as unknown as TrackedSymbolRow);

  const nextSymbol = input.symbol === undefined ? current.symbol : normalizeSymbol(input.symbol);
  const nextDisplayName =
    input.displayName === undefined
      ? current.displayName
      : String(input.displayName ?? "").trim().slice(0, 120);
  const nextActive = input.isActive === undefined ? current.isActive : Boolean(input.isActive);
  const now = new Date().toISOString();

  try {
    await turso.execute({
      sql: "UPDATE tracked_symbols SET symbol = ?, display_name = ?, is_active = ?, updated_at = ? WHERE id = ?",
      args: [nextSymbol, nextDisplayName, nextActive ? 1 : 0, now, numericId],
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("UNIQUE") || message.includes("unique")) {
      throw new Error(`Symbol ${nextSymbol} is already tracked.`);
    }
    throw error;
  }

  return {
    ...current,
    symbol: nextSymbol,
    displayName: nextDisplayName,
    isActive: nextActive,
    updatedAt: now,
  };
}

export async function deleteTrackedSymbol(id: unknown): Promise<void> {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    throw new Error("Valid symbol id is required.");
  }
  await ensureStockSchema();
  const result = await turso.execute({
    sql: "DELETE FROM tracked_symbols WHERE id = ?",
    args: [numericId],
  });
  if (Number(result.rowsAffected ?? 0) === 0) {
    throw new Error("Symbol not found.");
  }
}

/**
 * Seed the table from the legacy SYMBOLS env var on first run so existing
 * deployments migrate without manual re-entry. Only seeds when the table
 * is completely empty.
 */
export async function seedTrackedSymbolsFromEnv(): Promise<number> {
  await ensureStockSchema();
  const count = await countTrackedSymbols();
  if (count > 0) return 0;
  const envSymbols = parseEnvSymbols();
  if (envSymbols.length === 0) return 0;
  const now = new Date().toISOString();
  let seeded = 0;
  for (const symbol of envSymbols) {
    try {
      await turso.execute({
        sql: "INSERT INTO tracked_symbols (symbol, display_name, is_active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)",
        args: [symbol, "", now, now],
      });
      seeded += 1;
    } catch {
      // Ignore duplicates / races.
    }
  }
  return seeded;
}

/**
 * Source of truth for the collector and anywhere else that needs the
 * active symbol list. Reads from the DB table; seeds once from the legacy
 * SYMBOLS env var when the table is empty.
 */
export async function getCollectorSymbols(): Promise<string[]> {
  await ensureStockSchema();
  await seedTrackedSymbolsFromEnv();
  return listActiveSymbols();
}
