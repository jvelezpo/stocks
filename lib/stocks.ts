import type { Client, InArgs } from "@libsql/client";
import { ensureStockSchema, turso } from "./turso";

export type QuoteStat = {
  label: string;
  value: string;
};

export type PricePoint = {
  fetchedAt: string;
  price: number;
};

export type StockSummary = {
  id: number;
  symbol: string;
  name: string;
  price: number;
  priceText: string;
  change: number | null;
  changeText: string;
  changePercent: number | null;
  changePercentText: string;
  previousCloseText: string;
  openText: string;
  dayRangeText: string;
  marketCapText: string;
  volumeText: string;
  fetchedAt: string;
  sourceUrl: string;
  historyCount: number;
  documentCount: number;
  analysisCount: number;
  latestRecommendation: string;
  latestAnalysisStatus: string;
  hftCount: number;
  latestHftDecision: string;
  latestHftStatus: string;
  latestHftConfidence: number | null;
  latestHftMarketRegime: string;
  priceHistory: PricePoint[];
};

export type StockHistoryEntry = {
  id: number;
  fetchedAt: string;
  price: number;
  priceText: string;
  change: number | null;
  changeText: string;
  changePercent: number | null;
  changePercentText: string;
  marketCapText: string;
  volumeText: string;
};

export type StockDocument = {
  id: number;
  capturedAt: string;
  title: string;
  sourceUrl: string;
  bodyCharCount: number;
  wasTruncated: boolean;
  bodyPreview: string;
};

export type StockAnalysis = {
  id: number;
  createdAt: string;
  provider: string;
  model: string;
  status: string;
  recommendation: string;
  inputCharCount: number;
  outputCharCount: number;
  analysisText: string;
  errorText: string;
};

export type StockHftAnalysis = {
  id: number;
  createdAt: string;
  provider: string;
  model: string;
  status: string;
  decision: string;
  confidence: number | null;
  marketRegime: string;
  analysisText: string;
  errorText: string;
};

export type StockDetail = {
  latest: StockSummary & { stats: QuoteStat[] };
  history: StockHistoryEntry[];
  documents: StockDocument[];
  analyses: StockAnalysis[];
  hftAnalyses: StockHftAnalysis[];
};

type StockSummaryRow = {
  id: number;
  symbol: string;
  name: string;
  price: number;
  price_text: string;
  change: number | null;
  change_text: string;
  change_percent: number | null;
  change_percent_text: string;
  previous_close_text: string;
  open_text: string;
  day_range_text: string;
  market_cap_text: string;
  volume_text: string;
  fetched_at: string;
  source_url: string;
  stats_json: string;
  history_count: number;
  document_count: number;
  analysis_count: number;
  latest_recommendation: string | null;
  latest_analysis_status: string | null;
  hft_count: number;
  latest_hft_decision: string | null;
  latest_hft_status: string | null;
  latest_hft_confidence: number | null;
  latest_hft_market_regime: string | null;
};

type PricePointRow = {
  symbol: string;
  fetched_at: string;
  price: number;
};

type StockDocumentRow = {
  id: number;
  captured_at: string;
  title: string;
  source_url: string;
  body_char_count: number;
  was_truncated: number;
  body_preview: string;
};

type StockAnalysisRow = {
  id: number;
  created_at: string;
  provider: string;
  model: string;
  status: string;
  recommendation: string;
  input_char_count: number;
  output_char_count: number;
  analysis_text: string;
  error_text: string;
};

type StockHftAnalysisRow = {
  id: number;
  created_at: string;
  provider: string;
  model: string;
  status: string;
  decision: string;
  confidence: number | null;
  market_regime: string;
  analysis_text: string;
  error_text: string;
};

async function withDatabase<T>(read: (db: Client) => Promise<T>): Promise<T> {
  await ensureStockSchema();

  return read(turso);
}

async function allRows<T>(
  db: Client,
  sql: string,
  args?: InArgs
): Promise<T[]> {
  const result =
    args === undefined
      ? await db.execute(sql)
      : await db.execute({ sql, args });

  return result.rows as unknown as T[];
}

async function getRow<T>(
  db: Client,
  sql: string,
  args?: InArgs
): Promise<T | null> {
  const rows = await allRows<T>(db, sql, args);

  return rows[0] ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStats(value: string): QuoteStat[] {
  try {
    const parsed = JSON.parse(value) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((item) => {
      if (!isRecord(item) || typeof item.label !== "string" || typeof item.value !== "string") {
        return [];
      }

      return [{ label: item.label, value: item.value }];
    });
  } catch {
    return [];
  }
}

function mapSummary(row: StockSummaryRow, priceHistory: PricePoint[] = []): StockSummary {
  return {
    id: Number(row.id),
    symbol: row.symbol,
    name: row.name,
    price: Number(row.price),
    priceText: row.price_text,
    change: row.change === null ? null : Number(row.change),
    changeText: row.change_text,
    changePercent: row.change_percent === null ? null : Number(row.change_percent),
    changePercentText: row.change_percent_text,
    previousCloseText: row.previous_close_text,
    openText: row.open_text,
    dayRangeText: row.day_range_text,
    marketCapText: row.market_cap_text,
    volumeText: row.volume_text,
    fetchedAt: row.fetched_at,
    sourceUrl: row.source_url,
    historyCount: Number(row.history_count),
    documentCount: Number(row.document_count),
    analysisCount: Number(row.analysis_count),
    latestRecommendation: row.latest_recommendation ?? "",
    latestAnalysisStatus: row.latest_analysis_status ?? "",
    hftCount: Number(row.hft_count),
    latestHftDecision: row.latest_hft_decision ?? "",
    latestHftStatus: row.latest_hft_status ?? "",
    latestHftConfidence:
      row.latest_hft_confidence === null ? null : Number(row.latest_hft_confidence),
    latestHftMarketRegime: row.latest_hft_market_regime ?? "",
    priceHistory,
  };
}

function mapHistory(row: StockSummaryRow): StockHistoryEntry {
  return {
    id: Number(row.id),
    fetchedAt: row.fetched_at,
    price: Number(row.price),
    priceText: row.price_text,
    change: row.change === null ? null : Number(row.change),
    changeText: row.change_text,
    changePercent: row.change_percent === null ? null : Number(row.change_percent),
    changePercentText: row.change_percent_text,
    marketCapText: row.market_cap_text,
    volumeText: row.volume_text,
  };
}

function mapDocument(row: StockDocumentRow): StockDocument {
  return {
    id: Number(row.id),
    capturedAt: row.captured_at,
    title: row.title,
    sourceUrl: row.source_url,
    bodyCharCount: Number(row.body_char_count),
    wasTruncated: Boolean(row.was_truncated),
    bodyPreview: row.body_preview,
  };
}

function mapAnalysis(row: StockAnalysisRow): StockAnalysis {
  return {
    id: Number(row.id),
    createdAt: row.created_at,
    provider: row.provider,
    model: row.model,
    status: row.status,
    recommendation: row.recommendation,
    inputCharCount: Number(row.input_char_count),
    outputCharCount: Number(row.output_char_count),
    analysisText: row.analysis_text,
    errorText: row.error_text,
  };
}

function mapHftAnalysis(row: StockHftAnalysisRow): StockHftAnalysis {
  return {
    id: Number(row.id),
    createdAt: row.created_at,
    provider: row.provider,
    model: row.model,
    status: row.status,
    decision: row.decision,
    confidence: row.confidence === null ? null : Number(row.confidence),
    marketRegime: row.market_regime,
    analysisText: row.analysis_text,
    errorText: row.error_text,
  };
}

function latestSummarySql(whereClause = ""): string {
  return `
    WITH latest_history AS (
      SELECT *
      FROM (
        SELECT
          stock_history.*,
          ROW_NUMBER() OVER (
            PARTITION BY symbol
            ORDER BY fetched_at DESC, id DESC
          ) AS row_number
        FROM stock_history
        ${whereClause}
      )
      WHERE row_number = 1
    ),
    latest_analysis AS (
      SELECT *
      FROM (
        SELECT
          stock_analyses.*,
          ROW_NUMBER() OVER (
            PARTITION BY symbol
            ORDER BY created_at DESC, id DESC
          ) AS row_number
        FROM stock_analyses
      )
      WHERE row_number = 1
    ),
    latest_hft_analysis AS (
      SELECT *
      FROM (
        SELECT
          stock_hft_analyses.*,
          ROW_NUMBER() OVER (
            PARTITION BY symbol
            ORDER BY created_at DESC, id DESC
          ) AS row_number
        FROM stock_hft_analyses
      )
      WHERE row_number = 1
    ),
    history_counts AS (
      SELECT symbol, COUNT(*) AS history_count
      FROM stock_history
      GROUP BY symbol
    ),
    document_counts AS (
      SELECT symbol, COUNT(*) AS document_count
      FROM stock_documents
      GROUP BY symbol
    ),
    analysis_counts AS (
      SELECT symbol, COUNT(*) AS analysis_count
      FROM stock_analyses
      GROUP BY symbol
    ),
    hft_counts AS (
      SELECT symbol, COUNT(*) AS hft_count
      FROM stock_hft_analyses
      GROUP BY symbol
    )
    SELECT
      latest_history.id,
      latest_history.symbol,
      latest_history.name,
      latest_history.price,
      latest_history.price_text,
      latest_history.change,
      latest_history.change_text,
      latest_history.change_percent,
      latest_history.change_percent_text,
      latest_history.previous_close_text,
      latest_history.open_text,
      latest_history.day_range_text,
      latest_history.market_cap_text,
      latest_history.volume_text,
      latest_history.fetched_at,
      latest_history.source_url,
      latest_history.stats_json,
      COALESCE(history_counts.history_count, 0) AS history_count,
      COALESCE(document_counts.document_count, 0) AS document_count,
      COALESCE(analysis_counts.analysis_count, 0) AS analysis_count,
      latest_analysis.recommendation AS latest_recommendation,
      latest_analysis.status AS latest_analysis_status,
      COALESCE(hft_counts.hft_count, 0) AS hft_count,
      latest_hft_analysis.decision AS latest_hft_decision,
      latest_hft_analysis.status AS latest_hft_status,
      latest_hft_analysis.confidence AS latest_hft_confidence,
      latest_hft_analysis.market_regime AS latest_hft_market_regime
    FROM latest_history
    LEFT JOIN history_counts ON history_counts.symbol = latest_history.symbol
    LEFT JOIN document_counts ON document_counts.symbol = latest_history.symbol
    LEFT JOIN analysis_counts ON analysis_counts.symbol = latest_history.symbol
    LEFT JOIN latest_analysis ON latest_analysis.symbol = latest_history.symbol
    LEFT JOIN hft_counts ON hft_counts.symbol = latest_history.symbol
    LEFT JOIN latest_hft_analysis ON latest_hft_analysis.symbol = latest_history.symbol
  `;
}

export function getStockSummaries(): Promise<StockSummary[]> {
  return withDatabase(async (db) => {
    const summaryRows = await allRows<StockSummaryRow>(
      db,
      `${latestSummarySql()} ORDER BY latest_history.symbol ASC`
    );
    const historyRows = await allRows<PricePointRow>(
      db,
      `
        SELECT symbol, fetched_at, price
        FROM (
          SELECT
            symbol,
            fetched_at,
            price,
            id,
            ROW_NUMBER() OVER (
              PARTITION BY symbol
              ORDER BY fetched_at DESC, id DESC
            ) AS row_number
          FROM stock_history
        )
        WHERE row_number <= 18
        ORDER BY symbol ASC, fetched_at ASC, id ASC
      `
    );
    const historyBySymbol = new Map<string, PricePoint[]>();

    for (const row of historyRows) {
      const points = historyBySymbol.get(row.symbol) ?? [];
      points.push({
        fetchedAt: row.fetched_at,
        price: Number(row.price),
      });
      historyBySymbol.set(row.symbol, points);
    }

    return summaryRows.map((row) => mapSummary(row, historyBySymbol.get(row.symbol) ?? []));
  });
}

export async function getStockDetail(symbol: string): Promise<StockDetail | null> {
  const normalizedSymbol = symbol.trim().toUpperCase();

  if (!normalizedSymbol) {
    return null;
  }

  return withDatabase(async (db) => {
    const latestRow = await getRow<StockSummaryRow>(
      db,
      `${latestSummarySql("WHERE UPPER(symbol) = UPPER(?)")} LIMIT 1`,
      [normalizedSymbol]
    );

    if (!latestRow) {
      return null;
    }

    const historyRows = await allRows<StockSummaryRow>(
      db,
      `
        SELECT
          id,
          symbol,
          name,
          price,
          price_text,
          change,
          change_text,
          change_percent,
          change_percent_text,
          previous_close_text,
          open_text,
          day_range_text,
          market_cap_text,
          volume_text,
          fetched_at,
          source_url,
          stats_json,
          0 AS history_count,
          0 AS document_count,
          0 AS analysis_count,
          NULL AS latest_recommendation,
          NULL AS latest_analysis_status,
          0 AS hft_count,
          NULL AS latest_hft_decision,
          NULL AS latest_hft_status,
          NULL AS latest_hft_confidence,
          NULL AS latest_hft_market_regime
        FROM stock_history
        WHERE UPPER(symbol) = UPPER(?)
        ORDER BY fetched_at DESC, id DESC
        LIMIT 24
      `,
      [normalizedSymbol]
    );
    const priceHistory = [...historyRows]
      .reverse()
      .map((row) => ({ fetchedAt: row.fetched_at, price: Number(row.price) }));
    const documentRows = await allRows<StockDocumentRow>(
      db,
      `
        SELECT
          id,
          captured_at,
          title,
          source_url,
          body_char_count,
          was_truncated,
          substr(body_text, 1, 1400) AS body_preview
        FROM stock_documents
        WHERE UPPER(symbol) = UPPER(?)
        ORDER BY captured_at DESC, id DESC
        LIMIT 5
      `,
      [normalizedSymbol]
    );
    const analysisRows = await allRows<StockAnalysisRow>(
      db,
      `
        SELECT
          id,
          created_at,
          provider,
          model,
          status,
          recommendation,
          input_char_count,
          output_char_count,
          analysis_text,
          error_text
        FROM stock_analyses
        WHERE UPPER(symbol) = UPPER(?)
        ORDER BY created_at DESC, id DESC
        LIMIT 5
      `,
      [normalizedSymbol]
    );
    const hftRows = await allRows<StockHftAnalysisRow>(
      db,
      `
        SELECT
          id,
          created_at,
          provider,
          model,
          status,
          decision,
          confidence,
          market_regime,
          analysis_text,
          error_text
        FROM stock_hft_analyses
        WHERE UPPER(symbol) = UPPER(?)
        ORDER BY created_at DESC, id DESC
        LIMIT 5
      `,
      [normalizedSymbol]
    );

    return {
      latest: {
        ...mapSummary(latestRow, priceHistory),
        stats: parseStats(latestRow.stats_json),
      },
      history: historyRows.map(mapHistory),
      documents: documentRows.map(mapDocument),
      analyses: analysisRows.map(mapAnalysis),
      hftAnalyses: hftRows.map(mapHftAnalysis),
    };
  });
}
