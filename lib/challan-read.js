// Reads a delivery challan from the site's photo: challan number, date, vendor, vehicle and the items with quantities.
// Uses Claude (Anthropic API) when ANTHROPIC_API_KEY is set in Vercel; without it the site fills the receipt by hand.
// Optional: ANTHROPIC_MODEL (default below). The site always checks what was read before saving.
const configured = () => !!process.env.ANTHROPIC_API_KEY;
const MODEL = () => process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5';
const err = (status, message) => Object.assign(new Error(message), { status });

const PROMPT = `This is a photo of a delivery challan (or delivery note, docket, weighbridge slip or invoice) for construction material delivered to a building site in Mumbai.
Read it and answer with ONE JSON object only, no other text:
{"challan": "challan / docket / DC number as printed, or empty",
 "date": "date on the challan as YYYY-MM-DD, or empty",
 "vendor": "supplier name, or empty",
 "vehicle": "vehicle / truck / transit mixer number, or empty",
 "items": [{"description": "item as printed, e.g. TMT bar 16 mm, RMC M40, OPC 53 cement", "qty": number, "unit": "unit as printed, e.g. MT, kg, m3, cum, bags, nos"}],
 "unclear": "anything you could not read clearly, or empty"}
Use numbers for qty (no commas). If a weight is in kg and the item is steel, keep kg as printed. Never guess a value you cannot see; leave it empty instead.`;

async function read(dataUrl) {
  if (!configured()) throw err(409, 'Reading challans from a photo is not switched on yet. Fill in the receipt by hand.');
  const m = String(dataUrl).match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!m) throw err(400, 'Take a photo of the challan first.');
  let r, j;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL(), max_tokens: 800, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } }, { type: 'text', text: PROMPT }] }] }),
      signal: AbortSignal.timeout(45000),
    });
    j = await r.json().catch(() => ({}));
  } catch (e) { throw err(502, 'Could not reach the challan reader. Fill in the receipt by hand.'); }
  if (!r.ok) throw err(502, `The challan reader said: ${(j.error && j.error.message) || 'error ' + r.status}. Fill in the receipt by hand.`);
  const text = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  return parse(text);
}

// The reader's answer, cleaned: only the fields we use, sensible types and lengths.
function parse(text) {
  const s = String(text || ''), a = s.indexOf('{'), b = s.lastIndexOf('}');
  let o = {};
  try { o = JSON.parse(s.slice(a, b + 1)); } catch { throw err(502, 'Could not read this challan. Take a clearer photo or fill it in by hand.'); }
  const t = (v, n) => String(v ?? '').trim().slice(0, n);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(t(o.date, 10)) ? t(o.date, 10) : '';
  const items = (Array.isArray(o.items) ? o.items : []).slice(0, 12).map((i) => ({ description: t(i && i.description, 120), qty: Number(String(i && i.qty).replace(/,/g, '')) || 0, unit: t(i && i.unit, 20) })).filter((i) => i.description || i.qty);
  return { challan: t(o.challan, 60), date, vendor: t(o.vendor, 120), vehicle: t(o.vehicle, 30), items, unclear: t(o.unclear, 200) };
}

// A site engineer's spoken report in Hindi (or Hinglish), written out by the phone, turned into plain English work items.
async function toEnglish(text) {
  if (!configured()) throw err(409, 'Translation is not switched on yet.');
  const t = String(text || '').trim().slice(0, 3000);
  if (!t) throw err(400, 'Nothing to translate.');
  let r, j;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL(), max_tokens: 800, messages: [{ role: 'user', content: `A site engineer on a building site in Mumbai dictated this daily report in Hindi or Hinglish (the phone wrote it down, so expect mistakes). Rewrite it in short, plain English, one work item per line, keeping every number, floor, wing and material exactly. Answer with the lines only.\n\n${t}` }] }), signal: AbortSignal.timeout(30000) });
    j = await r.json().catch(() => ({}));
  } catch (e) { throw err(502, 'Could not reach the translator. Your words are kept as spoken.'); }
  if (!r.ok) throw err(502, 'The translator did not answer. Your words are kept as spoken.');
  return (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim().slice(0, 3000);
}

module.exports = { configured, read, parse, toEnglish };
