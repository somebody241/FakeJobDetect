import alasql from 'alasql';
import type { Review } from './csv.ts';

export function runQuery(sql: string, reviews: Review[]): Record<string, unknown>[] {
  const matches = sql.match(/\bdataset\b/gi);
  const rewritten = sql.replace(/\bdataset\b/gi, '?');
  const params = (matches ?? []).map(() => reviews);
  const result = alasql(rewritten, params) as unknown;
  if (!Array.isArray(result)) throw new Error('The query did not return a table.');
  return result as Record<string, unknown>[];
}

export function chartSeries(
  rows: Record<string, unknown>[],
): { name: string; points: { label: string; value: number }[] } | null {
  if (!rows.length) return null;
  const columns = Object.keys(rows[0]);
  if (columns.length < 2) return null;
  const labelKey = columns[0];
  const valueKey = columns.slice(1).find((column) =>
    rows.some((row) => typeof row[column] === 'number' && Number.isFinite(row[column] as number)),
  );
  if (!valueKey) return null;
  return {
    name: valueKey,
    points: rows.map((row) => ({
      label: row[labelKey] == null ? '' : String(row[labelKey]),
      value: typeof row[valueKey] === 'number' ? (row[valueKey] as number) : 0,
    })),
  };
}
