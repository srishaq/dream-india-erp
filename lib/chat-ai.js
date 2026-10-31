// Dream Chat's two smart extras, with Claude (Anthropic API) when ANTHROPIC_API_KEY is set in Vercel:
//  - "Catch me up": a short English summary of the messages someone has not read in a chat.
//  - Voice notes written out in English: the phone writes down what was said (often Hindi or Hinglish) while recording,
//    and Claude turns it into plain English. Without the key, the phone's own words are kept as they are.
const configured = () => !!process.env.ANTHROPIC_API_KEY;
const MODEL = () => process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5';

async function ask(prompt, max = 600) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL(), max_tokens: max, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(30000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error((j.error && j.error.message) || 'The summary could not be made just now.'), { status: 502 });
  return (j.content || []).map((c) => c.text || '').join('').trim();
}

async function catchUp(roomName, lines) {
  return ask(`These are the messages someone missed in "${roomName}", a work chat at Dream India, a Mumbai real estate developer (staff may write in English, Hindi or Hinglish). Write a short catch-up in plain English for a busy person: at most 6 short bullet points starting with "- ", most important first. Name who asked for what, any decision, any date or amount exactly as written, and anything waiting on the reader. No introduction.\n\n${lines.join('\n')}`, 500);
}

async function voiceToEnglish(said) {
  const t = String(said || '').trim();
  if (!t) return '';
  if (!configured()) return t;
  try {
    return await ask(`The phone wrote down this voice note from a work chat at Dream India, a Mumbai real estate developer. It may be Hindi, Hinglish or English, with mistakes. Write it in short, plain English, keeping every name, number, flat, floor and amount exactly. Answer with the English text only.\n\n${t}`, 400);
  } catch { return t; }
}

module.exports = { configured, catchUp, voiceToEnglish };
