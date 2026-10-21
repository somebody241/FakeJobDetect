export type Review = {
  salary_min: number | null;
  salary_max: number | null;
  required_experience_years: number;
  skills_listed: number;
  vague_word_count: number;
  exclamation_marks: number;
  allcaps_ratio: number;
  posting_hour: number;
  employer_response_delay_h: number;
  is_remote: number;
  free_mail_contact: number;
  company_age_months: number;
  company_size: number;
  category: string;
  mentions_trial_or_payment: number;
  scam: number;
};

export function parseReviews(text: string): Review[] {
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const headers = lines[0].split(',');
  return lines.slice(1).filter((line) => line.trim()).map((line) => {
    const cells = line.split(',');
    const row: Record<string, string | number | null> = {};
    headers.forEach((header, index) => {
      const raw = (cells[index] ?? '').trim();
      if (header === 'category') {
        row[header] = raw;
        return;
      }
      if (raw === '') {
        row[header] = null;
        return;
      }
      const value = Number(raw);
      row[header] = Number.isNaN(value) ? null : value;
    });
    return row as Review;
  });
}
