// The wording of the approved WhatsApp templates (as approved in Click Connect), so the ERP can show exactly what a
// buyer received: the template with its {{1}}, {{2}}… filled in. A template not listed shows its values only.
const T = {
  demand_letter_with_pdf: 'Dear {{1}}, please find attached the demand letter for your flat {{2}}. The amount due is {{3}}, payable by {{4}}. The bank details for payment are in the letter. If you have already paid, please ignore this message.',
  payment_receipt_with_pdf: 'Dear {{1}}, thank you for your payment of {{2}} for flat {{3}} received on {{4}}. Your payment receipt is attached.',
  dsig_demand_letter_pdf: 'Dear {{1}}, Prime Realtors / Dream India Realty has sent the demand letter for your flat {{2}} at Project - Dream Signature, Jogeshwari. Please find it attached. The amount due is {{3}}, payable by {{4}}. The bank details for payment are in the letter. If you have already paid, please ignore this message.',
  dsig_demand_letter_emailed: 'Dear {{1}}, Prime Realtors / Dream India Realty has sent the demand letter for your flat {{2}} at Project - Dream Signature, Jogeshwari, to your registered email address. The amount due is {{3}}, payable by {{4}}. Please check your email for the letter and the bank details for payment. If you have already paid, please ignore this message.',
  _demand_letter_emailed: 'Dear {{1}}, Dream India has sent the demand letter for your flat {{2}} to your registered email address. The amount due is {{3}}, payable by {{4}}. Please check your email for the letter and the bank details for payment. If you have already paid, please ignore this message.',
  _demand_letter_pdf: 'Dear {{1}}, Please find attached the demand letter for your flat {{2}}. The amount due is {{3}}, payable by {{4}}. The bank details for payment are in the letter. If you have already paid, please ignore this message.',
  _payment_received: 'Dear {{1}}, Thank you. We have received your payment of {{2}} for flat {{3}} on {{4}}. Your receipt will be sent to you shortly.',
  _payment_reminder: 'Dear {{1}}, This is a gentle reminder that {{2}} for your flat {{3}} is due on {{4}}. If you have already paid, please ignore this message. For any questions, simply reply here',
  _registration_appointment: 'Dear {{1}}, The registration of the agreement for your flat {{2}} is scheduled on {{3}} at {{4}}. Please bring your original PAN and Aadhaar cards and two passport-size photographs. Reply here if you need to change the date.',
};
// Click Connect IDs are the template name plus "_" and a 16-character code.
const nameOf = (id) => String(id || '').replace(/_[a-z0-9]{16}$/, '');
function render(id, params = []) {
  const t = T[nameOf(id)];
  if (!t) return null;
  return t.replace(/\{\{(\d+)\}\}/g, (m, n) => (params[n - 1] != null ? String(params[n - 1]) : m));
}
module.exports = { render, nameOf };
