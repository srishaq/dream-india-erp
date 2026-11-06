// Reads a filled paper call sheet (photo or scan, one or more pages): the outcome number (1-8) the telecaller wrote
// against each row, the remark, and a call-back date. Uses Claude (ANTHROPIC_API_KEY). Staff always check what was read
// on the screen before saving; nothing is saved by the reader itself.
const TM = require('./tm');

const configured = () => !!process.env.ANTHROPIC_API_KEY;
const MODEL = () => process.env.ANTHROPIC_VISION_MODEL || 'claude-sonnet-5-5';
const err = (status, message) => Object.assign(new Error(message), { status });

function prompt(sheet, leads) {
  const legend = Object.entries(TM.OUTCOMES).map(([k, v]) => `${k} = ${v}`).join('; ');
  const list = leads.map((l, i) => `${i + 1}. ${l.name || '(no name)'} · mobile ending ${String(l.mobile || '').slice(-4)}`).join('\n');
  return `These are photos or scans of a printed telecalling call sheet from Dream India Realty (sheet #${sheet.id}, caller ${sheet.caller}, ${sheet.sheet_date}).
The sheet has numbered rows (#) with Name and Mobile printed, and two columns the caller filled in by hand: "Outcome" (one digit) and "Remarks".
Outcome codes: ${legend}. A blank Outcome means the number was not called.

The printed rows are:
${list}

For every row where something is handwritten, read it. Match rows by the printed row number (#), and check the name / last 4 digits of the mobile to be sure.
Answer with ONE JSON object only, no other text:
{"rows": [{"n": row number, "code": the digit 1-8 or null if blank or unreadable, "remark": "handwritten remark as written, in English letters, or empty", "callback": "a call-back date if one is written, as YYYY-MM-DD (year ${String(sheet.sheet_date).slice(0, 4)} unless written), or empty", "sure": true or false}],
 "unclear": "rows or things you could not read clearly, or empty"}
Only include rows with handwriting. Never guess a digit you cannot see: use null and "sure": false.`;
}

async function read({ sheet, leads, files }) {
  if (!configured()) throw err(409, 'Reading call sheets from a photo is not switched on (it needs the Claude key in Vercel). Type the outcomes instead.');
  const parts = [];
  for (const f of (files || []).slice(0, 8)) {
    const m = String(f).match(/^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,(.+)$/);
    if (!m) throw err(400, 'Each page must be a photo (JPG or PNG) or a PDF.');
    parts.push(m[1] === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: m[2] } }
      : { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
  }
  if (!parts.length) throw err(400, 'Add a photo or scan of the filled sheet.');
  let r, j;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL(), max_tokens: 8000, messages: [{ role: 'user', content: [...parts, { type: 'text', text: prompt(sheet, leads) }] }] }),
      signal: AbortSignal.timeout(90000),
    });
    j = await r.json().catch(() => ({}));
  } catch (e) { throw err(502, 'Could not reach the sheet reader. Try again, or type the outcomes.'); }
  if (!r.ok) throw err(502, `The sheet reader said: ${(j.error && j.error.message) || 'error ' + r.status}. Type the outcomes instead.`);
  return parse((j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(''), leads);
}

// The reader's answer, cleaned and tied to the sheet's leads (row n → lead id).
function parse(text, leads) {
  const s = String(text || ''), a = s.indexOf('{'), b = s.lastIndexOf('}');
  let o = {};
  try { o = JSON.parse(s.slice(a, b + 1)); } catch { throw err(502, 'Could not read this sheet. Take a clearer, straight photo in good light, or type the outcomes.'); }
  const out = [];
  for (const x of Array.isArray(o.rows) ? o.rows : []) {
    const n = parseInt(x && x.n, 10), l = leads[n - 1];
    if (!l) continue;
    const code = parseInt(x.code, 10);
    out.push({ leadId: l.id, n, code: TM.OUTCOMES[code] ? code : null, remark: String(x.remark || '').trim().slice(0, 300),
      callback: /^\d{4}-\d{2}-\d{2}$/.test(String(x.callback || '')) ? x.callback : '', sure: x.sure !== false && !!TM.OUTCOMES[code] });
  }
  return { rows: out, unclear: String(o.unclear || '').trim().slice(0, 400) };
}

module.exports = { configured, read, parse };
