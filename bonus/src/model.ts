import { LABELS, MODEL_COLUMNS, type ModelColumn } from './content.ts';
import type { Review } from './csv.ts';

/** Coefficients, scaler, and medians copied from model.joblib. */
const MEDIANS: Record<'salary_min' | 'salary_max', number> = {
  salary_min: 4766.5,
  salary_max: 6650.5,
};

const MEAN = [
  4828.915, 6903.975, 4.7545, 14.7125, 0.031805, 11.945, 47.16, 15.7375, 0.1825,
];

const SCALE = [
  1274.1314297493018, 2367.7113383761543, 2.809426943346276, 6.2056300042783725,
  0.03145404544728706, 6.801983166694843, 53.82150499567993, 19.074160368152512,
  0.3862560679135022,
];

const COEF = [
  -1.5669707416049, 1.3187495258489115, -1.8867372215471307, -2.1072446124401267,
  1.5215913272510082, -0.44481592904560796, -0.701483511976119, -1.5325218934475948,
  0.1812197807481994,
];

const INTERCEPT = -3.2347908023934826;

export const SCORES = {
  accuracy: 0.9875,
  recall: 0.9727272727272727,
  precision: 0.982213438735178,
  rocAuc: 0.9992163009404388,
};

export type Posting = {
  salary_min: number | null;
  salary_max: number | null;
  required_experience_years: number;
  skills_listed: number;
  allcaps_ratio: number;
  posting_hour: number;
  company_age_months: number;
  company_size: number;
  mentions_trial_or_payment: number;
};

export type Neighbor = Review & { distance: number };

export type Score = {
  verdict: number;
  probability: number;
  closest: Neighbor[];
  pattern: string[];
  resultText: string;
};

export function postingFromReview(review: Review): Posting {
  return {
    salary_min: review.salary_min,
    salary_max: review.salary_max,
    required_experience_years: review.required_experience_years,
    skills_listed: review.skills_listed,
    allcaps_ratio: review.allcaps_ratio,
    posting_hour: review.posting_hour,
    company_age_months: review.company_age_months,
    company_size: review.company_size,
    mentions_trial_or_payment: review.mentions_trial_or_payment,
  };
}

export function scalePosting(posting: Posting): number[] {
  return MODEL_COLUMNS.map((column, index) => {
    let value = posting[column];
    if ((column === 'salary_min' || column === 'salary_max') && (value == null || Number.isNaN(value))) {
      value = MEDIANS[column];
    }
    return ((value as number) - MEAN[index]) / SCALE[index];
  });
}

function sigmoid(value: number): number {
  if (value >= 0) {
    const exp = Math.exp(-value);
    return 1 / (1 + exp);
  }
  const exp = Math.exp(value);
  return exp / (1 + exp);
}

function distance(left: number[], right: number[]): number {
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) {
    const delta = left[index] - right[index];
    sum += delta * delta;
  }
  return Math.sqrt(sum);
}

function displayValue(name: ModelColumn, posting: Posting): string {
  if (name === 'mentions_trial_or_payment') {
    return posting.mentions_trial_or_payment === 1 ? 'yes' : 'no';
  }
  const value = posting[name];
  if (value == null || Number.isNaN(value)) return 'not published';
  if (name === 'allcaps_ratio') return value.toFixed(3);
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1);
}

export function patternLines(posting: Posting, scaled: number[]): string[] {
  const rows = MODEL_COLUMNS.flatMap((name, index) => {
    const push = scaled[index] * COEF[index];
    if (Math.abs(push) < 1e-9) return [];
    return [{ push, name }];
  }).filter((row) => posting.salary_min != null || (row.name !== 'salary_min' && row.name !== 'salary_max'));

  const raises = rows.filter((row) => row.push >= 0.3).sort((a, b) => b.push - a.push);
  const lowers = rows.filter((row) => row.push <= -0.3).sort((a, b) => a.push - b.push);
  const lines = ['Feature pattern for this posting:'];
  lines.push(raises.length ? 'Raises the scam probability:' : 'No trait pushes this posting toward scam on its own.');
  for (const row of raises) lines.push(`- ${LABELS[row.name]}: ${displayValue(row.name, posting)}`);
  if (lowers.length) {
    lines.push('Lowers the scam probability:');
    for (const row of lowers) lines.push(`- ${LABELS[row.name]}: ${displayValue(row.name, posting)}`);
  }
  return lines;
}

function resultText(verdict: number, probability: number, closest: Neighbor[], lines: string[]): string {
  const label = verdict === 1 ? 'scam' : 'legitimate';
  const written = [
    `scam = ${verdict}`,
    `Verdict: ${label}`,
    `Scam probability: ${(probability * 100).toFixed(1)}%`,
    '',
    'Three closest reviewed postings:',
  ];
  closest.forEach((row, index) => {
    written.push(
      `${index + 1}. scam = ${Math.trunc(row.scam)}, skills ${Math.trunc(row.skills_listed)}, ` +
        `distance ${row.distance.toFixed(2)}, company age ${row.company_age_months.toFixed(0)} months, ` +
        `capital ratio ${row.allcaps_ratio.toFixed(3)}`,
    );
  });
  written.push('');
  written.push(...lines);
  return written.join('\n');
}

export function scorePosting(posting: Posting, reviews: Review[], scaledReviews: number[][]): Score {
  const scaled = scalePosting(posting);
  let logit = INTERCEPT;
  for (let index = 0; index < COEF.length; index += 1) logit += COEF[index] * scaled[index];
  const probability = sigmoid(logit);
  const verdict = probability >= 0.5 ? 1 : 0;
  const closest = scaledReviews
    .map((vector, index) => ({ index, distance: distance(scaled, vector) }))
    .sort((a, b) => a.distance - b.distance || a.index - b.index)
    .slice(0, 3)
    .map((item) => ({ ...reviews[item.index], distance: item.distance }));
  const pattern = patternLines(posting, scaled);
  return {
    verdict,
    probability,
    closest,
    pattern,
    resultText: resultText(verdict, probability, closest, pattern),
  };
}
