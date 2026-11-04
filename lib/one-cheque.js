// From go-live, one cheque pays one flat (4 Nov 2026 meeting). Cheques dated before this were sometimes written for
// two or three flats: those stay allowed (one receipt per flat, same cheque number) and are matched to the bank on
// the total of the parts.
module.exports = { ONE_CHEQUE_FROM: process.env.ONE_CHEQUE_FROM || '2026-11-05' };
