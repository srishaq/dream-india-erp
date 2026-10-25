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
