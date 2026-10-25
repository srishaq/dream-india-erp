// Money is handled in paise (whole numbers) inside JavaScript so sums never drift.
// The database stores numeric(14,2) rupees and returns them as exact strings.
const toPaise = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  const s = String(v).replace(/[₹,\s]/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return NaN;
  const [r, p = ''] = s.replace('-', '').split('.');
  const n = Number(r) * 100 + Number((p + '00').slice(0, 2));
  return s.startsWith('-') ? -n : n;
};
const rupees = (paise) => (paise / 100).toFixed(2);
module.exports = { toPaise, rupees };
