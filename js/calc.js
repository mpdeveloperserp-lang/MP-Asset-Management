/* Pure calculation and parsing helpers — no Firebase, no DOM. Unit-tested in tests/unit. */

const isNum = v => v !== null && v !== undefined && v !== '' && !isNaN(Number(v));

const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0,10); };

const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0,10); };

const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

const qtyOf = a => Number(a.qty) || 1;

const valueOf = a => isNum(a.cost) ? Number(a.cost) * qtyOf(a) : 0;

const sum = (arr, fn) => arr.reduce((s, x) => s + (Number(fn(x)) || 0), 0);

function isoOf(y, mo, d){
  const dt = new Date(Date.UTC(+y, +mo - 1, +d));
  if (dt.getUTCFullYear() !== +y || dt.getUTCMonth() !== +mo - 1 || dt.getUTCDate() !== +d) return null;
  return dt.toISOString().slice(0,10);
}

function parseDate(s){
  s = String(s || '').trim(); if (!s) return '';
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return isoOf(m[1], m[2], m[3]);
  if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/))) return isoOf(m[3], m[2], m[1]); // DD-MM-YYYY
  return null;
}

function parseCSV(text){
  const good = parseCSVRows(text);
  if (!good.length) return [];
  const hdr = good[0].map(h => h.trim().toLowerCase());
  return good.slice(1).map(r => Object.fromEntries(hdr.map((h, i) => [h, (r[i] ?? '').trim()])));
}

function parseCSVRows(text){
  text = text.replace(/^\uFEFF/, '');
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++){
    const ch = text[i];
    if (q){
      if (ch === '"'){ if (text[i+1] === '"'){ field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ','){ row.push(field); field = ''; }
    else if (ch === '\n'){ row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length){ row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

const g = (r, k) => (r[k.toLowerCase()] ?? '').trim();

function toCSV(header, rows){
  // Formula-injection guard: text starting with = + - @ (not a plain number) is prefixed with ' so Excel shows it as text.
  const safe = v => typeof v === 'string' && /^[=+\-@\t\r]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v) ? "'" + v : v;
  const q = v => { const s = String(safe(v) ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return '\uFEFF' + [header, ...rows].map(r => r.map(q).join(',')).join('\r\n');
}

function monthsBetween(a, b){
  const [y1,m1,d1] = a.split('-').map(Number), [y2,m2,d2] = b.split('-').map(Number);
  let m = (y2 - y1) * 12 + (m2 - m1); if (d2 < d1) m--; return Math.max(0, m);
}

function depr(a, asOf = today()){
  if (!isNum(a.cost) || !a.purchaseDate) return null;               // "Data Incomplete" → excluded
  const value = valueOf(a), salvage = Math.min(value, Number(a.salvage) || 0), life = Number(a.life) || 0;
  let end = asOf;
  if (a.status === 'Disposed' && a.disposal?.date && a.disposal.date < end) end = a.disposal.date;
  if (end < a.purchaseDate) return {value, acc:0, nbv:value, monthly:0};
  const base = value - salvage, monthly = life > 0 ? base / (life * 12) : 0;
  const acc = Math.min(base, monthly * monthsBetween(a.purchaseDate, end));
  return {value, acc, nbv: value - acc, monthly};
}

const fyStartYear = iso => { const [y, m] = iso.split('-').map(Number); return m >= 4 ? y : y - 1; };

const fyLabel = y => `FY ${y}-${String(y + 1).slice(2)}`;

const serialKeyOf = s => String(s || '').trim().toLowerCase().replace(/\//g, '_');

function serialProblem(s){
  s = String(s || '').trim(); if (!s) return '';
  if (s.length > 200) return `Serial number “${s.slice(0, 20)}…” is longer than 200 characters.`;
  const k = serialKeyOf(s);
  if (k === '.' || k === '..' || /^__.*__$/.test(k)) return `“${s}” cannot be used as a serial number.`;
  return '';
}

export { isNum, today, addDays, daysBetween, qtyOf, valueOf, sum, isoOf, parseDate, parseCSV, parseCSVRows, g, toCSV, monthsBetween, depr, fyStartYear, fyLabel, serialKeyOf, serialProblem };
