import { useMemo, useRef, useState } from 'react';
import { BarChart, DataTable, Metric, NumberField, RangeSlider, VerdictPanel } from './components.tsx';
import { LABELS, MODEL_COLUMNS, QUERY_NAMES, QUERIES } from './content.ts';
import { reviews, scaledReviews } from './data.ts';
import { extractUpload } from './extract.ts';
import { percent } from './format.ts';
import { applyFound, emptyFields, postingFromForm, type Fields } from './form.ts';
import { SCORES, scorePosting, type Neighbor } from './model.ts';
import { chartSeries, runQuery } from './sql.ts';
import {
  ageBounds,
  categoriesOf,
  categoryRates,
  filterReviews,
  groupMeans,
  LISTING_CHOICES,
  paymentRates,
  scamCorrelations,
  type ListingChoice,
} from './stats.ts';

const bounds = ageBounds(reviews);
const categoryOptions = ['All', ...categoriesOf(reviews)];
const scamCount = reviews.reduce((sum, review) => sum + review.scam, 0);

const numberColumns = new Set<string>(['distance', 'scam', ...MODEL_COLUMNS]);

function columnHeader(name: string, label = name) {
  return { key: name, label, align: numberColumns.has(name) ? ('right' as const) : ('left' as const) };
}

async function sha256(data: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export default function App() {
  const [tab, setTab] = useState<'check' | 'backlog' | 'query'>('check');

  return (
    <main className="page">
      <h1>Job posting check</h1>
      <p>
        A moderation desk for fake job listings. People applying for work run into postings that
        collect personal details or ask for money. Check a new listing against the saved model,
        explore the reviewed backlog, and query it with SQL.
      </p>
      <div className="tabs" role="tablist">
        <TabButton id="check" current={tab} onSelect={setTab}>
          Check a posting
        </TabButton>
        <TabButton id="backlog" current={tab} onSelect={setTab}>
          Backlog
        </TabButton>
        <TabButton id="query" current={tab} onSelect={setTab}>
          Query
        </TabButton>
      </div>
      {tab === 'check' ? <CheckTab /> : null}
      {tab === 'backlog' ? <BacklogTab /> : null}
      {tab === 'query' ? <QueryTab /> : null}
    </main>
  );
}

function TabButton({
  id,
  current,
  onSelect,
  children,
}: {
  id: 'check' | 'backlog' | 'query';
  current: string;
  onSelect: (id: 'check' | 'backlog' | 'query') => void;
  children: string;
}) {
  const selected = current === id;
  return (
    <button type="button" role="tab" aria-selected={selected} onClick={() => onSelect(id)}>
      {children}
    </button>
  );
}

function CheckTab() {
  const [fields, setFields] = useState<Fields>(emptyFields);
  const [note, setNote] = useState('');
  const [fileLabel, setFileLabel] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [resultText, setResultText] = useState('Check a posting to see the verdict.');
  const [verdict, setVerdict] = useState<number | null>(null);
  const [probability, setProbability] = useState<number | null>(null);
  const [closest, setClosest] = useState<Neighbor[] | null>(null);
  const [pattern, setPattern] = useState('');
  const digest = useRef('');
  const inputRef = useRef<HTMLInputElement>(null);

  function setField<Key extends keyof Fields>(key: Key, value: Fields[Key]) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  function clearVerdict(message: string) {
    setVerdict(null);
    setProbability(null);
    setClosest(null);
    setPattern('');
    setResultText(message);
  }

  async function takeFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 200 * 1024 * 1024) {
      setNote('Could not read that file (File is larger than 200MB.). Fill the fields below instead.');
      return;
    }
    const data = await file.arrayBuffer();
    const nextDigest = await sha256(data);
    setFileLabel(`${file.name} (${formatSize(file.size)})`);
    if (nextDigest === digest.current) return;
    digest.current = nextDigest;
    try {
      const { found, notes } = await extractUpload(file.name, data);
      setFields((current) => applyFound(current, found));
      setNote(notes.join(' '));
      if (Object.keys(found).length) {
        clearVerdict('Fields were filled from the file. Check this posting to see the verdict.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNote(`Could not read that file (${message}). Fill the fields below instead.`);
    }
  }

  function checkPosting() {
    const posting = postingFromForm(fields);
    if (!posting) {
      clearVerdict('Fill in every field. If the posting published no pay range, tick that box.');
      return;
    }
    setFields((current) => ({
      ...current,
      required_experience_years: posting.required_experience_years,
      skills_listed: posting.skills_listed,
      allcaps_ratio: posting.allcaps_ratio,
      posting_hour: posting.posting_hour,
      company_age_months: posting.company_age_months,
      company_size: posting.company_size,
      ...(current.no_pay_range
        ? {}
        : { salary_min: posting.salary_min, salary_max: posting.salary_max }),
    }));
    const scored = scorePosting(posting, reviews, scaledReviews);
    setVerdict(scored.verdict);
    setProbability(scored.probability);
    setClosest(scored.closest);
    setPattern(scored.pattern.join('\n'));
    setResultText(scored.resultText);
  }

  const closestRows = (closest ?? []).map((row) => {
    const record: Record<string, string | number | null> = {
      distance: row.distance.toFixed(2),
      scam: Math.trunc(row.scam),
    };
    for (const column of MODEL_COLUMNS) {
      const value = row[column];
      record[column] = column === 'allcaps_ratio' && typeof value === 'number' ? value.toFixed(3) : value;
    }
    return record;
  });

  return (
    <section>
      <h2>Check a new posting</h2>
      <p>
        Enter the listing, or drop a PDF or Word file and the app will fill what it can read. The
        box below returns scam = 1 or scam = 0, then the three closest reviewed postings.
      </p>
      <p className="caption">
        On held-out reviewed postings this check is right {percent(SCORES.accuracy)} of the time.
      </p>

      <h2>Drop a job posting</h2>
      <div
        className={dragOver ? 'drop over' : 'drop'}
        title="Accepts a PDF or a .docx file. The verdict uses the fields below, after you check them."
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          void takeFile(event.dataTransfer.files[0]);
        }}
      >
        {fileLabel ? (
          <div className="file-chip">
            <span>{fileLabel}</span>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setFileLabel('');
                if (inputRef.current) inputRef.current.value = '';
              }}
            >
              Remove
            </button>
          </div>
        ) : (
          <>
            <p>Drag and drop file here</p>
            <p className="hint">Limit 200MB per file • PDF, DOCX</p>
            <button type="button" className="secondary" onClick={() => inputRef.current?.click()}>
              Browse files
            </button>
          </>
        )}
        <input
          ref={inputRef}
          className="file-input"
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={(event) => {
            void takeFile(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </div>
      {note ? (
        <div className="info" role="status">
          <span className="info-icon" aria-hidden="true">
            i
          </span>
          <p>{note}</p>
        </div>
      ) : null}

      <h2>Or input manually</h2>
      <div className="form-grid">
        <div>
          <NumberField
            label="Minimum salary"
            min={0}
            step={100}
            disabled={fields.no_pay_range}
            value={fields.salary_min}
            onChange={(value) => setField('salary_min', value)}
          />
          <NumberField
            label="Maximum salary"
            min={0}
            step={100}
            disabled={fields.no_pay_range}
            value={fields.salary_max}
            onChange={(value) => setField('salary_max', value)}
          />
          <label className="check">
            <input
              type="checkbox"
              checked={fields.no_pay_range}
              onChange={(event) => setField('no_pay_range', event.target.checked)}
            />
            <span>No pay range was published</span>
          </label>
          <NumberField
            label="Experience required (years)"
            min={0}
            max={80}
            step={0.5}
            value={fields.required_experience_years}
            onChange={(value) => setField('required_experience_years', value)}
          />
          <NumberField
            label="Skills listed"
            min={0}
            max={100}
            step={1}
            value={fields.skills_listed}
            onChange={(value) => setField('skills_listed', value)}
          />
          <NumberField
            label="Capital-letter ratio"
            min={0}
            max={1}
            step={0.001}
            value={fields.allcaps_ratio}
            onChange={(value) => setField('allcaps_ratio', value)}
          />
          <label className="switch">
            <span>Asks for a trial fee, deposit, or payment details</span>
            <input
              type="checkbox"
              role="switch"
              checked={fields.mentions_trial_or_payment}
              onChange={(event) => setField('mentions_trial_or_payment', event.target.checked)}
            />
          </label>
        </div>
        <div>
          <NumberField
            label="Hour posted (0-23)"
            min={0}
            max={23}
            step={1}
            value={fields.posting_hour}
            onChange={(value) => setField('posting_hour', value)}
          />
          <NumberField
            label="Company age on the board (months)"
            min={0}
            max={2000}
            step={1}
            value={fields.company_age_months}
            onChange={(value) => setField('company_age_months', value)}
          />
          <NumberField
            label="Company size"
            min={1}
            max={100000}
            step={1}
            value={fields.company_size}
            onChange={(value) => setField('company_size', value)}
          />
        </div>
      </div>
      <button type="button" className="primary" onClick={checkPosting}>
        Check this posting
      </button>
      <VerdictPanel verdict={verdict} probability={probability} />
      <label className="field">
        <span className="field-label">Result</span>
        <textarea value={resultText} onChange={(event) => setResultText(event.target.value)} />
      </label>
      {verdict != null && closest ? (
        <>
          <h2>Three closest reviewed postings</h2>
          <p className="caption">
            scam = 1 means the trust and safety team confirmed that reviewed posting was a scam.
          </p>
          <DataTable
            columns={['distance', 'scam', ...MODEL_COLUMNS].map((name) => columnHeader(name))}
            rows={closestRows}
          />
          <h2>Feature pattern</h2>
          <pre className="pattern">{pattern}</pre>
        </>
      ) : null}
    </section>
  );
}

function BacklogTab() {
  const correlations = useMemo(() => scamCorrelations(reviews), []);
  const rates = useMemo(() => paymentRates(reviews), []);
  const means = useMemo(() => groupMeans(reviews), []);
  const [category, setCategory] = useState('All');
  const [age, setAge] = useState<[number, number]>([bounds.min, bounds.max]);
  const [choice, setChoice] = useState<ListingChoice>('All reviewed postings');
  const view = useMemo(
    () => filterReviews(reviews, category, age, choice),
    [category, age, choice],
  );
  const ratesByCategory = useMemo(
    () => (choice === 'All reviewed postings' && view.length ? categoryRates(view) : []),
    [choice, view],
  );

  const backlogColumns = ['category', ...MODEL_COLUMNS, 'scam'].map((name) => columnHeader(name));
  const backlogRows = view.map((review) => {
    const record: Record<string, string | number | null> = { category: review.category };
    for (const column of MODEL_COLUMNS) record[column] = review[column];
    record.scam = review.scam;
    return record;
  });

  return (
    <section>
      <h2>Reviewed backlog</h2>
      <p>
        These {reviews.length} postings were already reviewed. scam = 1 is a confirmed scam and
        scam = 0 is legitimate. Held-out accuracy is the share of postings the model labels
        correctly when that posting was not in its training rows.
      </p>
      <div className="metrics">
        <Metric label="Reviewed postings" value={String(reviews.length)} />
        <Metric label="Confirmed scams" value={String(scamCount)} />
        <Metric label="Held-out accuracy" value={percent(SCORES.accuracy)} />
        <Metric label="Scam recall" value={percent(SCORES.recall)} />
      </div>
      <p className="caption">
        Held-out accuracy is {percent(SCORES.accuracy)}. Precision on scams is{' '}
        {percent(SCORES.precision)}. The target for accuracy is 80%.
      </p>

      <h2>Characteristics associated with confirmed scams</h2>
      <p>
        The model keeps a column only when its correlation with scam is at least 0.2. Category,
        vague words, exclamation marks, response delay, remote, and free email are left out. Bars
        above zero are higher in confirmed scams. Bars below zero are higher in legitimate
        postings.
      </p>
      <BarChart points={correlations} />
      <DataTable
        columns={[
          { key: 'characteristic', label: 'Characteristic', align: 'left' },
          { key: 'yes', label: 'Scam rate when yes', align: 'right' },
          { key: 'no', label: 'Scam rate when no', align: 'right' },
        ]}
        rows={[
          {
            characteristic: LABELS.mentions_trial_or_payment,
            yes: percent(rates.yes, 0),
            no: percent(rates.no, 0),
          },
        ]}
      />
      <p>Average value of each characteristic in the two reviewed groups.</p>
      <DataTable
        columns={[
          { key: 'label', label: '', align: 'left' },
          { key: 'legit', label: 'Legitimate (scam = 0)', align: 'right' },
          { key: 'scam', label: 'Confirmed scam (scam = 1)', align: 'right' },
        ]}
        rows={means.map((row) => ({
          label: row.label,
          legit: row.legit.toFixed(2),
          scam: row.scam.toFixed(2),
        }))}
      />

      <h2>Filter the listings</h2>
      <label className="field">
        <span className="field-label">Category</span>
        <select value={category} onChange={(event) => setCategory(event.target.value)}>
          {categoryOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <RangeSlider
        label="Company age (months)"
        min={bounds.min}
        max={bounds.max}
        value={age}
        onChange={setAge}
      />
      <div className="field">
        <span className="field-label">Listings</span>
        <div className="radios">
          {LISTING_CHOICES.map((option) => (
            <label key={option} className="radio">
              <input
                type="radio"
                name="listings"
                checked={choice === option}
                onChange={() => setChoice(option)}
              />
              <span>{option}</span>
            </label>
          ))}
        </div>
      </div>
      <p>{view.length} postings match these filters.</p>
      {ratesByCategory.length ? (
        <>
          <p>Scam rate by category inside the current age filter.</p>
          <BarChart points={ratesByCategory} seriesName="Confirmed scams (%)" />
        </>
      ) : null}
      <DataTable columns={backlogColumns} rows={backlogRows} tall />
    </section>
  );
}

function QueryTab() {
  const [example, setExample] = useState(QUERY_NAMES[0]);
  const [sql, setSql] = useState(QUERIES[QUERY_NAMES[0]]);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Record<string, unknown>[] | null>(null);

  const chart = result ? chartSeries(result) : null;
  const columns =
    result && result.length
      ? Object.keys(result[0]).map((name) => ({
          key: name,
          label: name,
          align: result.some((row) => typeof row[name] === 'number') ? ('right' as const) : ('left' as const),
        }))
      : [];
  const rows = (result ?? []).map((row) => {
    const record: Record<string, string | number | null> = {};
    for (const [key, value] of Object.entries(row)) {
      if (value == null) record[key] = null;
      else if (typeof value === 'number' || typeof value === 'string') record[key] = value;
      else record[key] = String(value);
    }
    return record;
  });

  return (
    <section>
      <h2>Query the backlog</h2>
      <p>
        The reviewed postings are a table named dataset. Edit the SQL and run it. A bar chart is
        drawn when the result has a label column and a number column.
      </p>
      <label className="field">
        <span className="field-label">Example query</span>
        <select
          value={example}
          onChange={(event) => {
            const next = event.target.value;
            setExample(next);
            setSql(QUERIES[next]);
          }}
        >
          {QUERY_NAMES.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">SQL</span>
        <textarea className="sql" value={sql} onChange={(event) => setSql(event.target.value)} />
      </label>
      <button
        type="button"
        className="secondary"
        onClick={() => {
          try {
            setResult(runQuery(sql, reviews));
            setError('');
          } catch (caught) {
            setResult(null);
            setError(caught instanceof Error ? caught.message : String(caught));
          }
        }}
      >
        Run query
      </button>
      {error ? (
        <div className="error" role="alert">
          {error}
        </div>
      ) : null}
      {result ? (
        result.length ? (
          <DataTable columns={columns} rows={rows} />
        ) : (
          <p className="caption">The query returned no rows.</p>
        )
      ) : null}
      {chart ? <BarChart points={chart.points} seriesName={chart.name} /> : null}
    </section>
  );
}
