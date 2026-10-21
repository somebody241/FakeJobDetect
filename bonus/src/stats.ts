import { LABELS, MODEL_COLUMNS } from './content.ts';
import type { Review } from './csv.ts';

export type ListingChoice = 'All reviewed postings' | 'Confirmed scams' | 'Legitimate postings';

export const LISTING_CHOICES: ListingChoice[] = [
  'All reviewed postings',
  'Confirmed scams',
  'Legitimate postings',
];

function pearson(xs: number[], ys: number[]): number {
  const count = xs.length;
  if (count < 2) return 0;
  let sumX = 0;
  let sumY = 0;
  for (let index = 0; index < count; index += 1) {
    sumX += xs[index];
    sumY += ys[index];
  }
  const meanX = sumX / count;
  const meanY = sumY / count;
  let numerator = 0;
  let spreadX = 0;
  let spreadY = 0;
  for (let index = 0; index < count; index += 1) {
    const dx = xs[index] - meanX;
    const dy = ys[index] - meanY;
    numerator += dx * dy;
    spreadX += dx * dx;
    spreadY += dy * dy;
  }
  if (spreadX === 0 || spreadY === 0) return 0;
  return numerator / Math.sqrt(spreadX * spreadY);
}

function featureNumber(review: Review, name: string): number | null {
  const value = review[name as keyof Review];
  return typeof value === 'number' ? value : null;
}

export function scamCorrelations(reviews: Review[]): { label: string; value: number }[] {
  return MODEL_COLUMNS.map((name) => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const review of reviews) {
      const value = featureNumber(review, name);
      if (value == null) continue;
      xs.push(value);
      ys.push(review.scam);
    }
    return { label: LABELS[name] ?? name, value: pearson(xs, ys) };
  }).sort((a, b) => b.value - a.value);
}

export function paymentRates(reviews: Review[]): { yes: number; no: number } {
  const yesRows = reviews.filter((review) => review.mentions_trial_or_payment === 1);
  const noRows = reviews.filter((review) => review.mentions_trial_or_payment === 0);
  const mean = (rows: Review[]) => rows.reduce((sum, review) => sum + review.scam, 0) / rows.length;
  return { yes: mean(yesRows), no: mean(noRows) };
}

export type GroupMean = {
  label: string;
  legit: number;
  scam: number;
};

export function groupMeans(reviews: Review[]): GroupMean[] {
  const legit = reviews.filter((review) => review.scam === 0);
  const scam = reviews.filter((review) => review.scam === 1);
  const mean = (rows: Review[], name: string) => {
    const values = rows
      .map((review) => featureNumber(review, name))
      .filter((value): value is number => value != null);
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };
  return MODEL_COLUMNS.map((name) => {
    const left = mean(legit, name);
    const right = mean(scam, name);
    return { label: LABELS[name] ?? name, legit: left, scam: right, gap: right - left };
  })
    .sort((a, b) => b.gap - a.gap)
    .map(({ label, legit: legitMean, scam: scamMean }) => ({ label, legit: legitMean, scam: scamMean }));
}

export function ageBounds(reviews: Review[]): { min: number; max: number } {
  const ages = reviews.map((review) => review.company_age_months);
  return { min: Math.trunc(Math.min(...ages)), max: Math.trunc(Math.max(...ages)) };
}

export function categoriesOf(reviews: Review[]): string[] {
  return [...new Set(reviews.map((review) => review.category).filter(Boolean))].sort();
}

export function filterReviews(
  reviews: Review[],
  category: string,
  age: [number, number],
  choice: ListingChoice,
): Review[] {
  return reviews.filter((review) => {
    const ageOk = review.company_age_months >= age[0] && review.company_age_months <= age[1];
    const categoryOk = category === 'All' || review.category === category;
    const listingOk =
      choice === 'All reviewed postings' ||
      (choice === 'Confirmed scams' ? review.scam === 1 : review.scam === 0);
    return ageOk && categoryOk && listingOk;
  });
}

export function categoryRates(reviews: Review[]): { label: string; value: number }[] {
  const groups = new Map<string, { sum: number; count: number }>();
  for (const review of reviews) {
    const group = groups.get(review.category) ?? { sum: 0, count: 0 };
    group.sum += review.scam;
    group.count += 1;
    groups.set(review.category, group);
  }
  return [...groups.entries()]
    .map(([label, group]) => ({ label, value: (group.sum / group.count) * 100 }))
    .sort((a, b) => b.value - a.value);
}
