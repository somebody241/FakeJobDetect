import type { Posting } from './model.ts';

export type Fields = {
  salary_min: number | null;
  salary_max: number | null;
  no_pay_range: boolean;
  required_experience_years: number | null;
  skills_listed: number | null;
  allcaps_ratio: number | null;
  posting_hour: number | null;
  company_age_months: number | null;
  company_size: number | null;
  mentions_trial_or_payment: boolean;
};

type NumericField = {
  [Key in keyof Fields]: Fields[Key] extends number | null ? Key : never;
}[keyof Fields];

const LIMITS: Record<NumericField, [number, number | null]> = {
  salary_min: [0, null],
  salary_max: [0, null],
  required_experience_years: [0, 80],
  skills_listed: [0, 100],
  allcaps_ratio: [0, 1],
  posting_hour: [0, 23],
  company_age_months: [0, 2000],
  company_size: [1, 100000],
};

const INT_FIELDS = new Set<NumericField>(['skills_listed', 'posting_hour', 'company_size']);

const NUMERIC_FIELDS = Object.keys(LIMITS) as NumericField[];

export function emptyFields(): Fields {
  return {
    salary_min: null,
    salary_max: null,
    no_pay_range: false,
    required_experience_years: null,
    skills_listed: null,
    allcaps_ratio: null,
    posting_hour: null,
    company_age_months: null,
    company_size: null,
    mentions_trial_or_payment: false,
  };
}

export function clampField(key: NumericField, value: number): number {
  const [low, high] = LIMITS[key];
  let next = Math.max(low, value);
  if (high != null) next = Math.min(high, next);
  if (INT_FIELDS.has(key)) return Math.trunc(next);
  return next;
}

export function applyFound(current: Fields, found: Record<string, number | boolean>): Fields {
  const next: Fields = { ...current };
  if ('no_pay_range' in found) next.no_pay_range = Boolean(found.no_pay_range);
  if ('mentions_trial_or_payment' in found) {
    next.mentions_trial_or_payment = Boolean(found.mentions_trial_or_payment);
  }
  for (const key of NUMERIC_FIELDS) {
    const value = found[key];
    if (typeof value === 'number') next[key] = clampField(key, value);
  }
  return next;
}

export function postingFromForm(form: Fields): Posting | null {
  const required: NumericField[] = [
    'required_experience_years',
    'skills_listed',
    'allcaps_ratio',
    'posting_hour',
    'company_age_months',
    'company_size',
  ];
  if (!form.no_pay_range) required.unshift('salary_min', 'salary_max');
  if (required.some((key) => form[key] == null || Number.isNaN(form[key]))) return null;
  return {
    salary_min: form.no_pay_range ? null : clampField('salary_min', form.salary_min as number),
    salary_max: form.no_pay_range ? null : clampField('salary_max', form.salary_max as number),
    required_experience_years: clampField('required_experience_years', form.required_experience_years as number),
    skills_listed: clampField('skills_listed', form.skills_listed as number),
    allcaps_ratio: clampField('allcaps_ratio', form.allcaps_ratio as number),
    posting_hour: clampField('posting_hour', form.posting_hour as number),
    company_age_months: clampField('company_age_months', form.company_age_months as number),
    company_size: clampField('company_size', form.company_size as number),
    mentions_trial_or_payment: form.mentions_trial_or_payment ? 1 : 0,
  };
}
