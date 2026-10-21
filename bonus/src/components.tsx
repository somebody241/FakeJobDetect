import { useId, type CSSProperties } from 'react';
import { percent, formatTick } from './format.ts';

export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
    </div>
  );
}

const BULB_COUNT = 22;

function bulbPosition(index: number, count: number): CSSProperties {
  const p = index / count;
  let x = 0;
  let y = 0;
  if (p < 0.28) {
    x = (p / 0.28) * 100;
    y = 0;
  } else if (p < 0.5) {
    x = 100;
    y = ((p - 0.28) / 0.22) * 100;
  } else if (p < 0.78) {
    x = (1 - (p - 0.5) / 0.28) * 100;
    y = 100;
  } else {
    x = 0;
    y = (1 - (p - 0.78) / 0.22) * 100;
  }
  return { left: `${x}%`, top: `${y}%`, animationDelay: `${-index * 0.08}s` };
}

export function VerdictPanel({
  verdict,
  probability,
}: {
  verdict: number | null;
  probability: number | null;
}) {
  const scam = verdict === 1;
  const legit = verdict === 0;
  return (
    <div className="verdict" aria-live="polite">
      <VerdictSide
        title="Scam"
        detail={scam && probability != null ? percent(probability) : 'scam = 1'}
        lit={scam}
        kind="scam"
      />
      <VerdictSide
        title="No scam"
        detail={legit && probability != null ? percent(probability) : 'scam = 0'}
        lit={legit}
        kind="legit"
      />
    </div>
  );
}

function VerdictSide({
  title,
  detail,
  lit,
  kind,
}: {
  title: string;
  detail: string;
  lit: boolean;
  kind: 'scam' | 'legit';
}) {
  return (
    <div className={lit ? `marquee ${kind} lit` : `marquee ${kind}`}>
      <div className="bulb-track" aria-hidden="true">
        {Array.from({ length: BULB_COUNT }, (_, index) => (
          <span key={index} className="bulb" style={bulbPosition(index, BULB_COUNT)} />
        ))}
      </div>
      <div className="gold-frame">
        <div className="casino-face">
          <div className="verdict-title">{title}</div>
          <div className="verdict-detail">{detail}</div>
        </div>
        <div className="rod" aria-hidden="true" />
        <div className="valance" aria-hidden="true" />
        <div className={`curtain left ${kind}`} aria-hidden="true" />
        <div className={`curtain right ${kind}`} aria-hidden="true" />
        <div className="curtain-title" aria-hidden="true">
          {title}
        </div>
      </div>
    </div>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  disabled = false,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  step: number;
  disabled?: boolean;
}) {
  const id = useId();

  function bump(direction: number) {
    const base = value ?? min ?? 0;
    let next = base + direction * step;
    if (min != null) next = Math.max(min, next);
    if (max != null) next = Math.min(max, next);
    const places = step < 1 ? 3 : 0;
    onChange(places ? Number(next.toFixed(places)) : Math.trunc(next));
  }

  return (
    <div className="field">
      <span className="field-label" id={id}>
        {label}
      </span>
      <div className="stepper">
        <button type="button" disabled={disabled} onClick={() => bump(-1)} aria-label={`Decrease ${label}`}>
          −
        </button>
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          aria-labelledby={id}
          value={value ?? ''}
          onChange={(event) => {
            const raw = event.target.value;
            if (raw === '') {
              onChange(null);
              return;
            }
            const parsed = Number(raw);
            if (!Number.isNaN(parsed)) onChange(parsed);
          }}
        />
        <button type="button" disabled={disabled} onClick={() => bump(1)} aria-label={`Increase ${label}`}>
          +
        </button>
      </div>
    </div>
  );
}

export function DataTable({
  columns,
  rows,
  tall = false,
}: {
  columns: { key: string; label: string; align?: 'left' | 'right' }[];
  rows: Record<string, string | number | null>[];
  tall?: boolean;
}) {
  return (
    <div className={tall ? 'table-wrap tall' : 'table-wrap'}>
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} style={{ textAlign: column.align ?? 'left' }}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {columns.map((column) => (
                <td key={column.key} style={{ textAlign: column.align ?? 'left' }}>
                  {cellText(row[column.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function cellText(value: string | number | null | undefined): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (!Number.isFinite(value)) return '';
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 1000) / 1000);
}

export function BarChart({
  points,
  seriesName,
}: {
  points: { label: string; value: number }[];
  seriesName?: string;
}) {
  if (!points.length) return null;
  const rotateLabels = points.some((point) => point.label.length > 10);
  const width = 880;
  const padL = 64;
  const padR = 16;
  const padT = 18;
  const padB = rotateLabels ? 176 : 42;
  const height = 250 + padB;
  const values = points.map((point) => point.value);
  let min = Math.min(0, ...values);
  let max = Math.max(0, ...values);
  if (min === max) max = min + 1;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const yAt = (value: number) => padT + ((max - value) / (max - min)) * innerH;
  const zero = yAt(0);
  const slot = innerW / points.length;
  const barWidth = Math.min(36, slot * 0.62);
  const ticks = Array.from({ length: 5 }, (_, index) => max - ((max - min) * index) / 4);

  return (
    <figure className="chart">
      {seriesName ? <figcaption>{seriesName}</figcaption> : null}
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={seriesName ?? 'Bar chart'}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line className="grid" x1={padL} x2={width - padR} y1={yAt(tick)} y2={yAt(tick)} />
            <text className="tick" x={padL - 8} y={yAt(tick) + 4} textAnchor="end">
              {formatTick(tick)}
            </text>
          </g>
        ))}
        <line className="zero" x1={padL} x2={width - padR} y1={zero} y2={zero} />
        {points.map((point, index) => {
          const x = padL + slot * index + (slot - barWidth) / 2;
          const yValue = yAt(point.value);
          const top = Math.min(yValue, zero);
          const barHeight = Math.max(Math.abs(zero - yValue), point.value === 0 ? 0 : 1);
          const labelX = x + barWidth / 2;
          const labelY = padT + innerH + 14;
          return (
            <g key={`${point.label}-${index}`}>
              <rect className="bar" x={x} y={top} width={barWidth} height={barHeight} rx={2}>
                <title>{`${point.label}: ${point.value}`}</title>
              </rect>
              {rotateLabels ? (
                <text
                  className="xlabel"
                  textAnchor="start"
                  transform={`translate(${labelX}, ${labelY}) rotate(40)`}
                >
                  {point.label}
                </text>
              ) : (
                <text className="xlabel" x={labelX} y={labelY + 4} textAnchor="middle">
                  {point.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

export function RangeSlider({
  label,
  min,
  max,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  value: [number, number];
  onChange: (value: [number, number]) => void;
}) {
  const [low, high] = value;
  const span = Math.max(max - min, 1);
  const left = ((low - min) / span) * 100;
  const width = ((high - low) / span) * 100;
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="range-readout">
        {low} – {high}
      </div>
      <div className="range">
        <div className="range-track" />
        <div className="range-fill" style={{ left: `${left}%`, width: `${width}%` }} />
        <input
          type="range"
          min={min}
          max={max}
          value={low}
          aria-label={`${label} from`}
          onChange={(event) => onChange([Math.min(Number(event.target.value), high), high])}
        />
        <input
          type="range"
          min={min}
          max={max}
          value={high}
          aria-label={`${label} to`}
          onChange={(event) => onChange([low, Math.max(Number(event.target.value), low)])}
        />
      </div>
    </div>
  );
}
