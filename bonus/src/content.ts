export const LABELS: Record<string, string> = {
  salary_min: 'Minimum salary',
  salary_max: 'Maximum salary',
  required_experience_years: 'Experience required (years)',
  skills_listed: 'Skills listed',
  allcaps_ratio: 'Capital-letter ratio',
  posting_hour: 'Hour posted',
  company_age_months: 'Company age (months)',
  company_size: 'Company size',
  mentions_trial_or_payment: 'Asks for a fee or payment details',
  no_pay_range: 'No pay range published',
};

export const ALIASES: Record<string, string[]> = {
  salary_min: ['salary_min', 'salary min', 'minimum salary', 'min salary'],
  salary_max: ['salary_max', 'salary max', 'maximum salary', 'max salary'],
  required_experience_years: [
    'required_experience_years',
    'experience years',
    'years of experience',
    'experience required',
  ],
  skills_listed: ['skills_listed', 'skills listed', 'number of skills'],
  allcaps_ratio: ['allcaps_ratio', 'capital ratio', 'all caps ratio'],
  posting_hour: ['posting_hour', 'posting hour', 'hour posted'],
  company_age_months: ['company_age_months', 'company age', 'company age months'],
  company_size: ['company_size', 'company size'],
  mentions_trial_or_payment: [
    'mentions_trial_or_payment',
    'trial or payment',
    'asks for payment',
  ],
  no_pay_range: ['no pay range', 'salary missing'],
};

export const QUERIES: Record<string, string> = {
  'Scam rate by skills listed':
    'SELECT skills_listed,\n' +
    '       AVG(scam) AS scam_rate,\n' +
    '       COUNT(*) AS postings\n' +
    'FROM dataset\n' +
    'GROUP BY skills_listed\n' +
    'ORDER BY skills_listed',
  'Scam rate by exclamation marks':
    'SELECT exclamation_marks,\n' +
    '       AVG(scam) AS scam_rate,\n' +
    '       COUNT(*) AS postings\n' +
    'FROM dataset\n' +
    'GROUP BY exclamation_marks\n' +
    'ORDER BY exclamation_marks',
  'Scam rate by remote flag':
    'SELECT is_remote,\n' +
    '       AVG(scam) AS scam_rate,\n' +
    '       COUNT(*) AS postings\n' +
    'FROM dataset\n' +
    'GROUP BY is_remote',
};

export const QUERY_NAMES = Object.keys(QUERIES);

export const MANUAL_FIELDS = ['company_age_months', 'company_size', 'posting_hour'] as const;

export const MODEL_COLUMNS = [
  'salary_min',
  'salary_max',
  'required_experience_years',
  'skills_listed',
  'allcaps_ratio',
  'posting_hour',
  'company_age_months',
  'company_size',
  'mentions_trial_or_payment',
] as const;

export type ModelColumn = (typeof MODEL_COLUMNS)[number];

export function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export const ALIAS_TO_FIELD: Record<string, string> = {};
for (const [field, aliases] of Object.entries(ALIASES)) {
  for (const alias of aliases) ALIAS_TO_FIELD[normalize(alias)] = field;
}
