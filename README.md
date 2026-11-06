# Dream India ERP

A separate system from the live staff portal (portal.dreamindiarealty.com). It is built and tested here first;
real data moves in only after the CRM master sheet issues are cleaned and the test version is approved.

Blueprint: booking-to-collection, contractor billing, project costing, RERA tracking, one module at a time.

## What is built (foundation)
- Logins with roles, a temporary password on first sign-in, lock-out after 10 wrong passwords, sign-out everywhere on reset or disable.
- Two-step sign-in (ERP and DreamComm): after the password, the code from the person's sign-in app (authenticator, set up from Change password or right after sign-in), or a 6-digit code by email ("Email me a code instead"), or on WhatsApp once the Admin enters an approved Click Connect template in Manage users → Login security. A login with no email and no app adds its own email at sign-in (verified by a code). "Remember this device for 30 days"; a password change or reset, disabling, a new role or the Admin's "Sign out all devices" ends remembered devices. Codes are required only once the Admin ticks "Require the code". The break-glass Admin reset (ERP_ADMIN_RESET_USER / ERP_ADMIN_RESET_PASSWORD in Vercel) still signs in without a code. Optional ERP_TOTP_KEY in Vercel seals the sign-in app secrets with a key kept outside the database.
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

## DreamComm (company chat, `/chat`)
- Installable on phones and computers (Install / Add to Home Screen). Staff sign in with their ERP username and password and stay signed in for 30 days; that sign-in opens DreamComm only, never the rest of the ERP. Switching a login off ends it at once.
- One-to-one chats, groups anyone makes, a group per department (Sales, CRM, Accounts, Site, Purchase, Management) kept in step with each login's role (Management is not put in the other teams' groups), and Announcements (only Management posts). Consultants and the CA are guests: they see only the groups they are added to.
- Photos, documents and voice notes (up to 3 MB each, photos made smaller on the phone). No videos (Rafi Sir, 31 Oct 2026), replies, reactions, read ticks, @mentions, pins, saved messages, polls, search, mute, status and Do not disturb. Edit within 15 minutes, delete for everyone within 2 hours; deleted messages stay for the Admin's review (each review is in the audit log).
- Phone notifications through Web Push (`lib/webpush.js`, no outside packages; the key pair is made once and kept in settings).
- ERP updates in the department groups: purchase requests (Management, with an Approve button for the approvers), slab cast (Site and CRM), cheque returned (Accounts), daily report missing (Site). `/flat A-1203` shows a flat to the person asking only.
- With `ANTHROPIC_API_KEY`: "Catch me up" summaries, and voice notes written out in English.
- `chat.dreamindiarealty.com` opens DreamComm directly once the domain is added to the Vercel project.

## AI Agent Team (`/agents`, Rafi Sir, 6 Nov 2026)
- One marketing command centre for the company, used project by project: the drop-down at the start picks the company or a project; owner input, knowledge files, drafts, funnels, feed and counters belong to that choice.
- Signals → System of record → Owner input → The Brain (Claude) → Orchestrator (collects, scores, briefs, drafts, schedules, approves or calls the owner) → Knowledge layer (10 files; a project's own copy wins over the company's) → eight departments → Engage. Tools that are not connected show as waiting, never as running.
- What interrupts the loop: keyword comments, a lead at night, a lead not called in 2 hours, a thin content calendar (Content Engine drafts), a post taking off (repurpose; a boost goes to the owner), a complaint in the comments, comments without replies, cost per lead jumping. Search spikes and Google reviews wait for Search Console / Google Business.
- Drafts go to the Content calendar as Waiting for approval (Management approves; "routine posts ship without me" approves drafts with no price or offer). Nothing is published or spent from here; approved posts go out through the usual Marketing flow once a design is attached.
- Pre-RERA: a project without a MahaRERA number gets area and brand content only. Registered: every draft ends with the MahaRERA line.
- Comment-to-DM funnels: a comment with the keyword on a recent Instagram / Facebook post gets a private DM; a mobile number sent back becomes a lead (source Instagram/Facebook, the project), goes to sales and gets the WhatsApp welcome. A new funnel DMs only its test accounts until Management switches it to live. Needs the Meta app's instagram_manage_messages and pages_messaging permissions (Facebook / Instagram connected again after they are added).
- Cron `job=agents` every 10 minutes (funnels, comment notes, each switched-on scope every 30 minutes). Kill switch (Management) stops every agent. `AGENT_MODEL` (default claude-sonnet-5-5) and `ANTHROPIC_API_KEY` in Vercel.
- Learning (7 Nov 2026): `history.import` pulls two years of Instagram and Facebook posts with their figures into mkt_media; `history.analyse` has the Brain write `/brand-brain/what-worked.md` from the company accounts (owner `learnFrom`: dreamindiagroup, Dream India Group). The Content Engine reads it before every draft; the cron refreshes it monthly.
- Planning: three streams (the brand, Dream Signature, Dream Aspire; posts a week in Owner input). `plan.window` drafts one stream for up to two weeks with dates; festivals come from `/content/festivals.md` (the brand posts the greeting). The cron keeps each stream planned 3 weeks ahead (a week at a time) and designs drafts without a design (2 per run).
- Designs: Canva brand templates (post, carousel = one image per slide, reel cover) filled by autofill; `post.canva.attach` puts any Canva design (link, or an export link from another Canva account) on a post instead. A reel without a video goes out as an image post: attach the video for a real reel.
- Approving a draft that has a date and a design schedules it; the publisher posts it at that time.
- Canva library: `ag_canva_assets`; the cron copies past Instagram photos and videos of the learnFrom accounts into Canva Uploads (needs the asset:read/write scopes).

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
