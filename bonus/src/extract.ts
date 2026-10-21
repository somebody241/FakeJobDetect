import { ALIAS_TO_FIELD, LABELS, MANUAL_FIELDS, normalize } from './content.ts';

const PAYMENT_RE =
  /trial fee|deposit|payment details|upfront|wire transfer|gift card|processing fee|training fee|bank details/i;
const SALARY_RE =
  /(salary|pay|compensation)[^0-9]{0,40}\$?([\d,]+)k?\s*(-|to)\s*\$?([\d,]+)k?/i;
const EXPERIENCE_RE = /(\d+(?:\.\d+)?)\s*\+?\s*years?(?: of)? experience/i;
const NO_PAY_RE = /salary not (?:disclosed|listed|published)|no (?:salary|pay range)|unpaid/i;
const SKILLS_RE = /(?:skills|requirements|qualifications)\s*[:\-]\s*(.+)/i;

const INT_KEYS = new Set(['skills_listed', 'posting_hour', 'company_size']);
const BOOL_KEYS = new Set(['no_pay_range', 'mentions_trial_or_payment']);

export function parseValue(field: string, raw: unknown): number | boolean | null {
  const text = String(raw).trim();
  if (['', 'na', 'n/a', 'none', 'nan', '-'].includes(text.toLowerCase())) return null;
  if (BOOL_KEYS.has(field)) return ['1', 'true', 'yes', 'y'].includes(text.toLowerCase());
  const cleaned = text.replace(/,/g, '').replace(/\$/g, '').trim();
  const number = Number(cleaned);
  if (Number.isNaN(number)) return null;
  if (INT_KEYS.has(field)) return Math.trunc(number);
  return number;
}

function absorb(found: Record<string, number | boolean>, key: unknown, raw: unknown) {
  const field = ALIAS_TO_FIELD[normalize(String(key))];
  if (!field) return;
  const value = parseValue(field, raw);
  if (value != null) found[field] = value;
}

export function structuredFeatures(text: string, tables: string[][][]): Record<string, number | boolean> {
  const found: Record<string, number | boolean> = {};
  for (const table of tables) {
    if (!table.length || !table[0]?.length) continue;
    const fields = table[0].map((cell) => ALIAS_TO_FIELD[normalize(cell || '')] ?? null);
    const recognized = fields.filter((field) => field != null).length;
    if (recognized >= 2 && table.length > 1) {
      fields.forEach((field, index) => {
        if (!field) return;
        const value = parseValue(field, table[1][index]);
        if (value != null) found[field] = value;
      });
      break;
    }
    if (table[0].length === 2) {
      for (const row of table) {
        if (row.length >= 2) absorb(found, row[0], row[1]);
      }
      if (Object.keys(found).length) break;
    }
  }
  for (const line of text.split(/\r?\n/)) {
    const separator = line.includes(':') ? ':' : line.includes('=') ? '=' : '';
    if (!separator) continue;
    const index = line.indexOf(separator);
    absorb(found, line.slice(0, index), line.slice(index + 1));
  }
  return found;
}

function isLetter(char: string): boolean {
  return char.toLowerCase() !== char.toUpperCase();
}

export function proseFeatures(text: string): Record<string, number | boolean> {
  if (!text.trim()) return {};
  const letters = [...text].filter(isLetter);
  const found: Record<string, number | boolean> = {
    allcaps_ratio: letters.length ? letters.filter((char) => char === char.toUpperCase()).length / letters.length : 0,
    mentions_trial_or_payment: PAYMENT_RE.test(text),
  };
  if (NO_PAY_RE.test(text)) found.no_pay_range = true;
  const salary = text.match(SALARY_RE);
  if (salary) {
    let minimum = Number(salary[2].replace(/,/g, ''));
    let maximum = Number(salary[4].replace(/,/g, ''));
    if (salary[0].toLowerCase().includes('k') && maximum < 1000) {
      minimum *= 1000;
      maximum *= 1000;
    }
    if (minimum >= 100 && maximum >= minimum) {
      found.salary_min = minimum;
      found.salary_max = maximum;
      found.no_pay_range = false;
    }
  }
  const experience = text.match(EXPERIENCE_RE);
  if (experience) found.required_experience_years = Number(experience[1]);
  const skills = text.match(SKILLS_RE);
  if (skills) {
    const parts = skills[1].split(/,|\n|•/).map((part) => part.trim()).filter(Boolean);
    if (parts.length) found.skills_listed = parts.length;
  }
  return found;
}

export function describeExtraction(text: string, found: Record<string, number | boolean>): string[] {
  if (!text.trim() && Object.keys(found).length === 0) {
    return ['No text could be read from that file. Fill the fields below instead.'];
  }
  const filled = Object.entries(found)
    .filter(([key, value]) => !(key === 'no_pay_range' && !value))
    .map(([key]) => LABELS[key] ?? key);
  const notes = [`Filled from the file: ${filled.join(', ')}.`];
  const missing = MANUAL_FIELDS.filter((key) => !(key in found)).map((key) => LABELS[key]);
  if (missing.length) notes.push(`The file did not include: ${missing.join(', ')}.`);
  return notes;
}

function combine(text: string, tables: string[][][]): Record<string, number | boolean> {
  const found = proseFeatures(text);
  for (const [key, value] of Object.entries(structuredFeatures(text, tables))) found[key] = value;
  return found;
}

type PdfItem = { str: string; x: number; y: number };

function linesOf(items: PdfItem[]): PdfItem[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: PdfItem[][] = [];
  for (const item of sorted) {
    const line = lines.find((candidate) => Math.abs(candidate[0].y - item.y) < 3);
    if (line) line.push(item);
    else lines.push([item]);
  }
  for (const line of lines) line.sort((a, b) => a.x - b.x);
  return lines;
}

function usefulTable(rows: string[][]): boolean {
  if (rows.length < 2 || rows[0].length < 2) return false;
  const headers = rows[0].map((cell) => ALIAS_TO_FIELD[normalize(cell || '')] ?? null);
  if (headers.filter(Boolean).length >= 2) return true;
  if (rows[0].length !== 2) return false;
  const matched = rows.filter((row) => row.length >= 2 && ALIAS_TO_FIELD[normalize(row[0] || '')]).length;
  return matched >= 2;
}

async function readPdf(data: ArrayBuffer): Promise<{ text: string; tables: string[][][] }> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const document = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const texts: string[] = [];
  const tables: string[][][] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const items: PdfItem[] = [];
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue;
      items.push({ str: item.str, x: item.transform[4], y: item.transform[5] });
    }
    const lines = linesOf(items);
    texts.push(lines.map((line) => line.map((item) => item.str).join(' ')).join('\n'));
    const rows = lines.map((line) => {
      const cells: string[] = [];
      let buffer = '';
      let lastX = Number.NEGATIVE_INFINITY;
      for (const item of line) {
        if (item.x - lastX > 28 && buffer.trim()) {
          cells.push(buffer.trim());
          buffer = item.str;
        } else {
          buffer = buffer ? `${buffer} ${item.str}` : item.str;
        }
        lastX = item.x + item.str.length * 4;
      }
      if (buffer.trim()) cells.push(buffer.trim());
      return cells;
    });
    if (usefulTable(rows)) tables.push(rows);
  }
  return { text: texts.join('\n'), tables };
}

function localText(node: Element): string {
  let text = '';
  for (const child of node.getElementsByTagName('*')) {
    if (child.localName === 't') text += child.textContent ?? '';
    else if (child.localName === 'tab') text += '\t';
    else if (child.localName === 'br') text += '\n';
  }
  return text;
}

function direct(parent: Element, name: string): Element[] {
  return [...parent.children].filter((child) => child.localName === name);
}

async function readDocx(data: ArrayBuffer): Promise<{ text: string; tables: string[][][] }> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(data);
  const file = zip.file('word/document.xml');
  if (!file) throw new Error('The Word file has no document.xml.');
  const xml = await file.async('string');
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  const body = [...document.getElementsByTagName('*')].find((node) => node.localName === 'body');
  if (!body) throw new Error('The Word file has no body.');
  const texts: string[] = [];
  const tables: string[][][] = [];
  for (const child of body.children) {
    if (child.localName === 'p') {
      texts.push(localText(child));
      continue;
    }
    if (child.localName !== 'tbl') continue;
    const rows = direct(child, 'tr').map((row) =>
      direct(row, 'tc').map((cell) => direct(cell, 'p').map(localText).join('\n').trim()),
    );
    if (rows.length) tables.push(rows);
  }
  return { text: texts.join('\n'), tables };
}

export async function extractUpload(
  name: string,
  data: ArrayBuffer,
): Promise<{ found: Record<string, number | boolean>; notes: string[] }> {
  const lower = name.toLowerCase();
  let text = '';
  let tables: string[][][] = [];
  if (lower.endsWith('.pdf')) ({ text, tables } = await readPdf(data));
  else if (lower.endsWith('.docx')) ({ text, tables } = await readDocx(data));
  else throw new Error('Upload a PDF or a .docx file.');
  const found = combine(text, tables);
  return { found, notes: describeExtraction(text, found) };
}
