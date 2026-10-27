// Starting content for HR & Admin: leave types, letter templates and first-draft HR policies.
// These are only used until the Admin saves their own version in the portal (stored in KV);
// after that the saved version wins. Drafted 16-Oct-2026 for review by management and the CA / lawyer:
// leave days, notice periods and statutory items must be checked against the state's Shops and
// Establishments Act and the company's own practice before staff are told.

const LEAVE_TYPES = [
  { key: 'EL', label: 'Annual leave (earned)', days: 15, accrues: true, note: '1.25 days a month; carry forward up to 30 days' },
  { key: 'SL', label: 'Sick leave', days: 7, note: 'Doctor\'s note for more than 2 days in a row' },
  { key: 'CL', label: 'Casual leave', days: 7, note: 'At most 3 days at a time' },
  { key: 'COMP', label: 'Compensatory off', days: 0, note: 'Given for approved work on a Sunday or holiday; use within 60 days' },
  { key: 'MAT', label: 'Maternity leave', days: 182, note: '26 weeks under the Maternity Benefit Act' },
  { key: 'PAT', label: 'Paternity leave', days: 5 },
  { key: 'BRV', label: 'Bereavement leave', days: 3 },
  { key: 'LOP', label: 'Leave without pay', days: 0, note: 'Only when other leave is used up, with approval' },
];

// {{field}} placeholders are filled from the employee record and the company details.
const TEMPLATES = [
  {
    id: 'offer', title: 'Offer letter',
    body: `{{today}}

{{name}}
{{address}}

Subject: Offer of employment

Dear {{name}},

We are pleased to offer you the position of {{designation}} in the {{department}} department of {{company}}, on the terms below.

1. Date of joining: {{startDate}}. Place of work: {{location}}. You will report to {{reportingTo}}.
2. Compensation: your annual cost to company (CTC) will be Rs {{ctc}} ({{ctcWords}}). The break-up is in Annexure A. Salary is paid monthly by bank transfer, after deduction of tax and statutory contributions.
3. Probation: you will be on probation for {{probation}} months from the date of joining. On satisfactory completion you will be confirmed in writing.
4. Working hours and leave: as per the company's HR policies in force, which may be updated from time to time.
5. Notice period: during probation, either side may end employment with {{noticeProbation}} days' notice. After confirmation, the notice period is {{notice}} days, or salary in lieu of notice at the company's discretion.
6. Confidentiality: you will sign the company's Non-Disclosure Agreement on or before joining.
7. Documents: please bring originals and copies of your Aadhaar, PAN, educational and experience certificates, relieving letter from your last employer, two photographs and a cancelled cheque on the day of joining.

This offer is valid until {{offerValidTill}}. Please sign and return a copy to accept it.

We look forward to welcoming you.

For {{company}}


{{signatory}}
{{signatoryTitle}}


Accepted: ____________________   Date: ____________
{{name}}

Annexure A: Salary break-up (per month)
Basic: Rs {{basic}}
House rent allowance: Rs {{hra}}
Other allowances: Rs {{allowances}}
Gross monthly salary: Rs {{gross}}
Annual CTC: Rs {{ctc}}`,
  },
  {
    id: 'nda', title: 'Non-Disclosure Agreement',
    body: `NON-DISCLOSURE AND CONFIDENTIALITY AGREEMENT

This Agreement is made on {{today}} between {{company}}, having its office at {{companyAddress}} (the "Company"), and {{name}}, {{designation}}, residing at {{address}} (the "Employee").

1. Confidential information means all information the Employee receives or learns because of their work, in any form, including customer names, contact details, booking and payment records, flat allotments, prices and offers, broker and channel partner terms, vendor and contractor rates, drawings, approvals, land and project documents, bank details, accounts, salaries, business plans, and login details for company systems.

2. The Employee will:
   a. use confidential information only to do their work for the Company;
   b. not disclose it to anyone outside the Company, or to colleagues who do not need it for their work;
   c. not copy, photograph, download, forward to personal email or phone, or take away any company data or documents, except as their work requires;
   d. keep their portal and system passwords private and not let anyone else use their login;
   e. tell their manager at once if they learn that confidential information has been lost or disclosed.

3. Customer data: the Employee will treat customers' personal details (including Aadhaar, PAN and bank details) with special care, and will not contact customers for any purpose other than Company business.

4. Return of material: when employment ends, or earlier if asked, the Employee will return all Company documents, devices, keys and access cards, and delete any Company data held on personal devices.

5. Non-solicitation: for twelve (12) months after leaving, the Employee will not use confidential information to approach the Company's customers, channel partners or employees to take business or staff away from the Company.

6. Duration: these obligations start on the date of joining and continue after employment ends, for as long as the information remains confidential.

7. Exceptions: this Agreement does not cover information that is already public through no fault of the Employee, or disclosure required by law or a court, provided the Employee informs the Company first where allowed.

8. Breach: a breach of this Agreement is misconduct and may lead to disciplinary action including termination, and the Company may seek damages and an injunction.

9. This Agreement is governed by the laws of India, and the courts at {{jurisdiction}} have jurisdiction.

For {{company}}                                  Employee


____________________                          ____________________
{{signatory}}                                     {{name}}
{{signatoryTitle}}                                Date:

Witness: ____________________`,
  },
  {
    id: 'confirm', title: 'Confirmation letter',
    body: `{{today}}

{{name}}
Employee no. {{empNo}}

Subject: Confirmation of employment

Dear {{name}},

We are pleased to confirm your employment as {{designation}}, {{department}}, with effect from {{confirmDate}}, on successful completion of your probation.

All other terms of your offer letter dated {{startDate}} remain unchanged. Your notice period is now {{notice}} days.

For {{company}}


{{signatory}}
{{signatoryTitle}}`,
  },
  {
    id: 'relieving', title: 'Relieving and experience letter',
    body: `{{today}}

TO WHOMSOEVER IT MAY CONCERN

This is to certify that {{name}} (employee no. {{empNo}}) worked with {{company}} as {{designation}} in the {{department}} department from {{startDate}} to {{endDate}}.

They have been relieved of their duties with effect from the close of working hours on {{endDate}}, and their full and final settlement has been completed.

We wish them success in the future.

For {{company}}


{{signatory}}
{{signatoryTitle}}`,
  },
];

// First drafts. Plain text; lines starting with "# " are headings and "- " are bullets.
const POLICIES = [
  {
    id: 'leave', title: 'Leave policy', version: 'Draft 1',
    body: `# Who this covers
All permanent employees of the company, at the office and at site. Contract staff and consultants follow their contracts.

# Leave year
The leave year runs from 1 April to 31 March, the same as the financial year.

# Leave you get each year
- Annual leave (earned): 15 working days. It builds up at 1.25 days for each month worked. People who join mid-year get it pro rata.
- Sick leave: 7 days.
- Casual leave: 7 days, at most 3 days at a time.
- Compensatory off: one day for each approved full day worked on a Sunday or public holiday, to be used within 60 days.
- Maternity leave: 26 weeks for the first two children (12 weeks after that), as the Maternity Benefit Act requires, for employees who have worked at least 80 days in the 12 months before.
- Paternity leave: 5 working days, within 3 months of the child's birth.
- Bereavement leave: 3 days on the death of a parent, spouse, child or sibling.
- Public holidays: as per the holiday list published each January.

# During probation
New joiners can take sick and casual leave from the first month. Annual leave builds up from day one but can be used only after confirmation, unless the manager approves.

# Carry forward and encashment
- Unused annual leave carries forward to the next year, up to a total of 30 days. Anything above 30 lapses on 31 March.
- Sick and casual leave do not carry forward and are not paid out.
- On leaving, unused annual leave (up to 30 days) is paid at basic salary in the full and final settlement.

# Sundays and holidays
Sundays and public holidays that fall inside a leave period are not counted as leave, except for maternity leave.

# Leave without pay
If an employee has no leave balance, approved absence is leave without pay. Absence without approval for 3 working days in a row is treated as unauthorised absence and may lead to disciplinary action.

# Records
HR keeps every employee's leave balance in the portal under HR & Admin. Employees can ask HR for their balance at any time.`,
  },
  {
    id: 'leave-request', title: 'How to request leave', version: 'Draft 1',
    body: `# Planned leave (annual leave, casual leave)
- Ask at least 3 working days ahead for 1 to 2 days, and 2 weeks ahead for 3 days or more.
- Enter the request in the portal (HR & Admin, Leave), or give the request to HR, who will enter it.
- Your manager approves or rejects it within 2 working days. Do not book travel until it is approved.
- Site staff must arrange cover with the Site Head before going on leave.

# Sick leave and emergencies
- Tell your manager by phone or message before 10 am on the first day.
- Enter the leave in the portal, or ask HR to, on the day you return.
- For sick leave of more than 2 days in a row, give HR a doctor's certificate.

# Half days
A half day is either the first half (until 1:30 pm) or the second half. It counts as 0.5 day of leave.

# Cancelling
You can cancel a request until it starts. If you come back early, tell HR so the unused days go back to your balance.

# Busy periods
Management may limit leave during month-end, possession handovers, audits or major site activity. Requests for these periods may be moved, with reasons given.`,
  },
  {
    id: 'hours', title: 'Working hours and attendance', version: 'Draft 1',
    body: `# Working week
- Office: Monday to Saturday, 9:30 am to 6:30 pm, with a one-hour lunch break.
- Site: as set by the Site Head for the work on hand, within the limits of labour law.
- Sunday is the weekly off.

# Attendance
- Mark attendance every day by the method HR sets (biometric, register or app).
- Arriving more than 15 minutes late 3 times in a month counts as half a day of casual leave.
- Field visits, bank work and customer meetings count as working time; tell your manager beforehand.

# Overtime and work on holidays
Work on a Sunday or holiday must be approved in advance by your manager. It earns compensatory off (see the leave policy).`,
  },
  {
    id: 'appraisal', title: 'Performance appraisal', version: 'Draft 1',
    body: `# Cycle
- One annual appraisal for the financial year (April to March), done in April. Revised salaries apply from 1 April.
- A short mid-year check-in in October to review progress against goals.
- People who joined after 1 October are reviewed in the next cycle; their first increment may be pro rata.

# Steps
- April: the manager and the employee agree 4 to 6 goals for the year, recorded in the portal.
- March: the employee writes a self-review against those goals.
- April: the manager rates each goal and the overall performance, and meets the employee to discuss it.
- Management reviews all ratings together for fairness and approves increments and promotions.
- HR issues the revision letter and updates the salary in the portal.

# Rating scale
- 5, Outstanding: far beyond goals; a role model.
- 4, Exceeds: beyond goals on most counts.
- 3, Meets: delivered what was agreed.
- 2, Partly meets: some goals missed; needs a plan to improve.
- 1, Does not meet: most goals missed.

# What is assessed
- Results against goals (for example bookings and collections for sales, accuracy and timeliness for accounts, schedule and quality for site).
- Ways of working: reliability, teamwork, customer handling, honesty with data and money.

# Improvement plan
An employee rated 1 or 2 gets a written improvement plan of 60 to 90 days with clear targets and monthly reviews.

# Increments and promotions
Increments depend on the rating and the company's budget for the year. A promotion needs a rating of 4 or 5 and an open role at the higher level.`,
  },
  {
    id: 'probation', title: 'Joining, probation and leaving', version: 'Draft 1',
    body: `# Joining
On the first day each new employee gives HR copies of: Aadhaar, PAN, educational certificates, experience and relieving letters, two photographs, and a cancelled cheque or bank details. HR uploads them to the employee's record in the portal and returns the originals.
Every employee signs the Non-Disclosure Agreement before getting access to company systems or customer data.

# Probation
Probation is 6 months. The manager confirms in writing, extends probation by up to 3 months, or ends employment. A confirmation letter is issued from the portal.

# Notice period
- During probation: 15 days on either side.
- After confirmation: 30 days for staff, 60 days for managers and heads of department.
- The company may pay salary instead of notice, or accept a shorter notice, at its discretion.

# Leaving
- Resign in writing (email is fine) to your manager and HR.
- Hand over work, files, keys, devices and passwords before your last day. HR disables your portal login on your last day.
- Full and final settlement is paid within 30 days of the last day, after handover is complete.
- HR issues the relieving and experience letter from the portal with the settlement.`,
  },
  {
    id: 'conduct', title: 'Code of conduct and confidentiality', version: 'Draft 1',
    body: `# Customers and money
- Never take cash or payments from customers into a personal account. All customer payments go to the company's bank accounts, with a receipt.
- Never promise a customer prices, discounts, possession dates or terms that management has not approved in writing.
- Record every customer payment and change in the CRM the same day.

# Data and documents
- Customer and company information is confidential (see the Non-Disclosure Agreement).
- Do not share your portal login. Lock your screen when you leave your desk.
- Do not send customer documents (Aadhaar, PAN, agreements) to personal email or WhatsApp.

# Gifts and conflicts of interest
Do not accept gifts above Rs 2,000 in value from vendors, contractors, brokers or customers. Tell management if you or a relative have an interest in a vendor, contractor or a flat purchase.

# Respect at work
The company does not tolerate harassment, discrimination or abuse of anyone. Sexual harassment complaints are handled by the Internal Committee under the POSH Act, 2013 (required once the company has 10 or more employees); the committee's names and contact details are displayed in the office.

# Safety at site
Wear a helmet and safety shoes at site at all times, and follow the Site Head's safety instructions.

# Breaking the rules
Breaches may lead to a warning, suspension or termination, depending on how serious they are, after the employee has been heard.`,
  },
];

const COMPANY = {
  company: 'Dream India Realty', companyAddress: '', signatory: 'Mr Syed', signatoryTitle: 'Director', location: 'Head office',
  jurisdiction: '', probation: '6', noticeProbation: '15', notice: '30',
};

const DEPARTMENTS = ['Management', 'Sales & CRM', 'Accounts', 'Construction / Site', 'Purchase', 'HR & Admin', 'Legal & Liaison', 'Marketing', 'Drivers & Support'];
const DOC_TYPES = ['Aadhaar', 'PAN', 'Photo', 'Educational certificate', 'Experience / relieving letter', 'Offer letter (signed)', 'NDA (signed)', 'Bank / cancelled cheque', 'Resume', 'Appraisal', 'Other'];

module.exports = { LEAVE_TYPES, TEMPLATES, POLICIES, COMPANY, DEPARTMENTS, DOC_TYPES };
