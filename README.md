# Dream India ERP

A separate system from the live staff portal (portal.dreamindiarealty.com). It is built and tested here first;
real data moves in only after the CRM master sheet issues are cleaned and the test version is approved.

Blueprint: booking-to-collection, contractor billing, project costing, RERA tracking, one module at a time.

## What is built (foundation)
- Logins with roles, a temporary password on first sign-in, lock-out after 10 wrong passwords, sign-out everywhere on reset or disable.
- Companies, projects, buildings and payment plans. Dream Signature (Prime Realtors) comes pre-loaded with A Wing, B Wing, Rehab Tower and its 15-stage plan.
- Audit log of every change: who, when, before and after.
- Database structure for Module 1 (units, buyers, bookings, demands, receipts), ready for the screens that come next.

## Roles and approvals (maker and checker)
| Role | Can |
|---|---|
| Admin | Everything, including logins and master data |
| Management | See everything, approve cancellations, bookings, demands and receipts |
| Head CRM | Enter and approve bookings, raise and approve demands |
| CRM Team | Enter bookings, prepare demands, see ledgers |
| Sales | See inventory, enter bookings |
| Head Accounts | Enter and approve receipts, see the audit log |
| Accounts Team | Enter receipts |
| Site Head | Record construction stages as complete |
| View only | See inventory and ledgers |

The person who enters something can never approve it.

## Construction and purchase (site Today page)
- Site Engineers open Construction on the **Today** page: four big buttons (Request material, Material came in, Daily report, Report a problem), deliveries expected and their own requests.
- **Request material** raises a purchase request against the floor's BOQ line (balance shown in quantities only).
- **Material came in** picks the purchase order, takes a photo of the challan (read automatically when `ANTHROPIC_API_KEY` is set in Vercel), confirms the quantities, and also logs the delivery in the site materials register.
- Site logins never see rates, bill amounts or payments.
- Every new request goes to Management by email with a one-tap approval link (`/approve`, valid 3 days, for that person only), and on WhatsApp once Click Connect is connected and the approval template is set (Management dashboard → 10 am message). Replying `APPROVE PR-0012` or `REJECT PR-0012 reason` on WhatsApp from the approver's own mobile (Manage users → phone) also works. A request waiting 24 hours gets a reminder to Management (Sameer). The Admin is not sent site approvals.
- **10 am summary** (cron `job=summary`, 04:30 UTC) to Admin and Management: what needs attention, over-budget requests, cash needed in the next 14 days.

## Construction, second set
- **Slab cast → demands:** when site marks a payment-stage slab cast (Plinth, every 5th slab, Top Slab; not the Rehab tower), Head CRM gets a high-priority Daily To-Do and Head CRM and Management an email, to get the architect's certificate, record the stage and raise the demands (`lib/slab-stage.js`).
- **Pours & cubes** (Construction tab): every pour with grade, quantity, supplier, challans and cube sets; marking a slab Cast asks for its pour, and the RMC goes into the materials log. 7- and 28-day results (pass: 7-day ≥ 65% of the grade, 28-day ≥ the grade); tests due show on Today; failures and late results on the Management dashboard and in the 10 am summary.
- **Daily report:** 6 pm email to the site team if today's report is not in (cron `job=dpr`, 12:30 UTC); "no report yesterday" on the dashboard; speak instead of typing (English, or Hindi turned into English when `ANTHROPIC_API_KEY` is set).
- **Contractor bills** (`/contracts`, from Purchase): work orders (items, rates, retention, TDS, advance and its recovery, allowed RMC/steel wastage) and RA bills (previous, this bill, cumulative; slab items suggested from slabs cast; material recovery suggested from the site's design vs used quantities). Purchase enters, Management approves (not the person who entered it), Accounts pay. Site logins have no access.

## Technology
- No outside packages. `lib/pg.js` is a small PostgreSQL client (TLS, SCRAM-SHA-256, parameterised queries).
- Database: Postgres (Neon, added from Vercel → Storage). Its address arrives as `DATABASE_URL`.
- Hosting: Vercel, project **dream-india-erp**. Every push to `main` deploys.
- Database changes live in `lib/migrations.js` and apply automatically, once, in order. Never edit one that has run; add a new one.

## First-time setup
1. Vercel → dream-india-erp → Storage → Create Database → Neon → connect to all environments.
2. Open the ERP's address. It asks for the first Admin's name, username and password, creates the tables, and signs you in.
3. Optional: set `ERP_SETUP_CODE` in Vercel before step 2 to require a code on the setup screen.

## Local run and tests
```
DATABASE_URL=postgres://user:pass@127.0.0.1:5432/db node scripts/dev-server.js   # http://localhost:3000
DATABASE_URL=postgres://user:pass@127.0.0.1:5432/empty_db node scripts/test.js    # end-to-end checks
```
