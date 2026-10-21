import { readFileSync } from 'node:fs';
import { parseReviews } from '../src/csv.ts';
import { proseFeatures } from '../src/extract.ts';
import { postingFromReview, scalePosting, scorePosting } from '../src/model.ts';
import { groupMeans, paymentRates, scamCorrelations } from '../src/stats.ts';
import { runQuery } from '../src/sql.ts';

const reviews = parseReviews(readFileSync(new URL('../../data.csv', import.meta.url), 'utf8'));
const scaled = reviews.map((review) => scalePosting(postingFromReview(review)));

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

assert(reviews.length === 400, `expected 400 reviews, got ${reviews.length}`);
assert(reviews.reduce((sum, review) => sum + review.scam, 0) === 109, 'expected 109 scams');

const scam = scorePosting(
  {
    salary_min: null,
    salary_max: null,
    required_experience_years: 1,
    skills_listed: 4,
    allcaps_ratio: 0.18,
    posting_hour: 2,
    company_age_months: 2,
    company_size: 3,
    mentions_trial_or_payment: 1,
  },
  reviews,
  scaled,
);
const scamScaled = scalePosting({
  salary_min: null,
  salary_max: null,
  required_experience_years: 1,
  skills_listed: 4,
  allcaps_ratio: 0.18,
  posting_hour: 2,
  company_age_months: 2,
  company_size: 3,
  mentions_trial_or_payment: 1,
});
const expectedScaled = [-0.048986, -0.107055, -1.336394, -1.726255, 4.711477, -1.462074, -0.83907, -0.667788, 2.116472];
scamScaled.forEach((value, index) => {
  assert(Math.abs(value - expectedScaled[index]) < 1e-4, `scaled[${index}] ${value}`);
});
assert(scam.verdict === 1, `verdict ${scam.verdict}`);
assert(Math.abs(scam.probability - 0.99999687068) < 1e-6, `probability ${scam.probability}`);
const neighborIndex = scam.closest.map((row) =>
  reviews.findIndex(
    (review) =>
      review.skills_listed === row.skills_listed &&
      review.company_age_months === row.company_age_months &&
      review.allcaps_ratio === row.allcaps_ratio &&
      review.company_size === row.company_size &&
      review.posting_hour === row.posting_hour &&
      review.required_experience_years === row.required_experience_years &&
      review.salary_min === row.salary_min &&
      review.scam === row.scam,
  ),
);
assert(neighborIndex.join(',') === '112,56,39', `neighbor order ${neighborIndex.join(',')}`);
const distances = [2.333959, 3.034077, 3.139369];
scam.closest.forEach((row, index) => {
  assert(Math.abs(row.distance - distances[index]) < 1e-3, `distance ${row.distance}`);
});

const legit = scorePosting(
  {
    salary_min: 50000,
    salary_max: 70000,
    required_experience_years: 5,
    skills_listed: 12,
    allcaps_ratio: 0.02,
    posting_hour: 10,
    company_age_months: 80,
    company_size: 200,
    mentions_trial_or_payment: 0,
  },
  reviews,
  scaled,
);
assert(legit.verdict === 0, `legit verdict ${legit.verdict}`);
assert(legit.probability < 1e-6, `legit probability ${legit.probability}`);

const correlations = scamCorrelations(reviews).map((row) => [row.label, row.value] as const);
assert(correlations[0][0] === 'Capital-letter ratio', correlations[0][0]);
assert(Math.abs(correlations[0][1] - 0.724263) < 1e-4, `corr ${correlations[0][1]}`);
assert(correlations.at(-1)?.[0] === 'Skills listed', 'last correlation');

const pay = paymentRates(reviews);
assert(Math.abs(pay.yes - 0.479452) < 1e-4, `pay yes ${pay.yes}`);
assert(Math.abs(pay.no - 0.2263) < 1e-4, `pay no ${pay.no}`);

const means = groupMeans(reviews);
assert(means[0].label === 'Maximum salary', means[0].label);
assert(Math.abs(means[0].legit - 6378.08) < 0.02, `mean ${means[0].legit}`);
assert(Math.abs(means[0].scam - 8974.81) < 0.02, `mean scam ${means[0].scam}`);

const queried = runQuery(
  'SELECT skills_listed, AVG(scam) AS scam_rate, COUNT(*) AS postings FROM dataset GROUP BY skills_listed ORDER BY skills_listed',
  reviews,
);
assert(queried.length > 1, 'query rows');
assert('scam_rate' in queried[0], 'query column');

const found = proseFeatures('URGENT\nSalary: $4,500 to $8,000\n3 years of experience\nSkills: Excel, Python, SQL\nwire transfer');
assert(found.salary_min === 4500, `salary ${String(found.salary_min)}`);
assert(found.salary_max === 8000, `salary max ${String(found.salary_max)}`);
assert(found.required_experience_years === 3, 'experience');
assert(found.skills_listed === 3, `skills ${String(found.skills_listed)}`);
assert(found.mentions_trial_or_payment === true, 'payment');
assert(found.no_pay_range === false, 'pay range');

console.log('selfcheck ok');
console.log(scam.resultText.split('\n').slice(0, 8).join('\n'));
