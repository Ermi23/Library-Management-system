# Library Management System

A web-based integrated library system (ILS) in the spirit of Koha: cataloging with ISBN / MARC 21 / Dewey,
barcode-driven circulation, holds, fines, multi-branch transfers, stock-taking, acquisitions, serials,
reports, patron notices and a public online catalog (OPAC) with "My account".

| Layer    | Stack |
|----------|-------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS 4, React Router 7, TanStack Query |
| Backend  | Node.js 20, Express 5, TypeScript, Prisma 6, Zod 4, Nodemailer |
| Database | PostgreSQL 16 (pg_trgm for ranked keyword search) |
| Auth     | Email or library card + password, JWT in an httpOnly cookie, roles: Admin / Librarian / Patron |

## Quick start with Docker

```bash
docker compose up -d --build
```
This starts PostgreSQL, the API and the web app. On every start the backend applies pending migrations
(`prisma migrate deploy`) and runs the seed, which is safe to run more than once.
- Web app: http://localhost:8080 (staff area at `/staff`)
- API: http://localhost:4000/api
- PostgreSQL: `localhost:5433` (user/password `lms`, database `library`)

Demo accounts (password `Library@123`, or whatever `SEED_PASSWORD` is set to):

| Role      | Sign in with |
|-----------|--------------|
| Admin     | `admin@library.local` |
| Librarian | `librarian@library.local` |
| Patron    | `patron@library.local` or card `1000000001` |

The demo catalog (12 real titles, copies at two branches, patrons, loans, a hold, a vendor, a fund and a
magazine subscription) is only added to an empty database. Set `SEED_DEMO=false` to skip it.
**Change the demo passwords before real use.**

Configuration for Docker goes in a root `.env` file (read by docker compose):

| Variable | Purpose |
|----------|---------|
| `JWT_SECRET` | Long random string that signs login sessions (required in production) |
| `SEED_PASSWORD` | Password given to the demo accounts |
| `TZ` | Library timezone, e.g. `Africa/Addis_Ababa`; loans fall due at the end of the local day |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Optional email delivery for notices |

Useful commands: `docker compose logs -f backend`, `docker compose exec backend npx prisma migrate reset --force`
(wipes and re-seeds the database), `docker compose down -v` (stops everything and deletes the database).

## Local development

1. Node.js 20+ and PostgreSQL 16 (local, or the Docker `db` service on port 5433).
2. `cp backend/.env.example backend/.env` and set `DATABASE_URL` and `JWT_SECRET`.
3. Install, migrate and seed:
   ```bash
   npm install
   npm run db:migrate
   npm run db:seed
   ```
4. `npm run dev`: web app on http://localhost:5173, API on http://localhost:4000/api.

Checks: `npm run typecheck`, `npm test -w backend` (unit tests for ISBN, MARC, call numbers, dates, search text),
`npm run build`.

## Modules

### Cataloging
- **Add a title by ISBN**: scan the barcode on the back cover; the record is fetched in parallel from the
  Library of Congress (full MARC 21 record), Open Library and Google Books, merged, and checked for duplicates.
- ISBN-10/ISBN-13 checksum validation and conversion; duplicate ISBNs are refused.
- **Classification**: Dewey numbers (`005.133`) or shelf labels (`FIC`, `E`, `B`, `REF`); call numbers are generated
  as classification + author mark (`823.914 ACH`).
- Copies (items) with generated or pre-printed barcodes, item types, home/current branch, shelf location,
  volume, price and status history. Status changes: damaged, lost (bills the borrower), missing, withdrawn.
- **MARC 21**: view any record in MARC, export one or all records as ISO 2709 (`.mrc`) or MARCXML, import
  `.mrc`/MARCXML with preview, duplicate detection and copies created from Koha-style 952 holdings.
- Spine and barcode label printing (Code 128).

### Circulation
- Barcode-driven **check out / check in / renew** desk, designed for USB scanners.
- Rules per branch × patron category × item type: loan period, loan limit, renewals, hold limit, pickup days,
  fine per day and fine cap. The most specific rule wins.
- Borrowing blocks (suspended, expired membership, fines over the limit, overdue items) with a
  **librarian override** that is recorded in the audit log.
- Check-in **routes each copy**: hold shelf for the next patron in the queue, transfer to the pickup branch,
  transfer back to the home branch, or reshelve. Overdue fines are charged automatically on return.
- Holds queue, *holds to pull*, hold shelf with expiry, inter-branch transfers.
- Fines and payments: overdue, lost, damage and manual charges; partial payments; waivers; payment methods.

### Patrons
- Registration with auto-generated card numbers and membership expiry by category; membership renewal.
- Patron record: current loans (renew, mark lost), holds, fines & payments, reading history, notices, profile.
- Printable library card with barcode.

### Collection management
- **Inventory / stock-take**: scan the shelves, see what is missing, misplaced or wrongly shown as on loan,
  and optionally mark unscanned copies missing. Lists of lost, missing, damaged and withdrawn copies.
- **Acquisitions**: vendors, funds with allocated / committed / spent / available, purchase orders
  (draft, placed, partially received, received), overspend warnings, receiving that creates catalog copies.
- **Serials**: subscriptions with predicted issues (weekly to annual), check-in that creates circulating
  copies, late-issue list for claiming.

### Reports, notices and administration
- Dashboard with today's tasks (overdues, holds to pull, hold shelf, incoming transfers) and a 14-day trend.
- Reports with CSV export: circulation trend, most borrowed titles, collection by Dewey class / type / branch /
  status, patrons by category, top borrowers, fines by type and payment method, overdue list with contacts,
  weeding candidates.
- Notices: due-soon, overdue (at configurable intervals), hold ready, hold expired, fines, membership expiry and
  free-text messages. They appear in the patron's account and, when SMTP is configured, are emailed.
  Background jobs run hourly.
- Settings: library details and currency, circulation policies, rules, item types, patron categories.
- Audit log of every checkout, override, payment, edit and setting change.

### OPAC (public catalog)
- Ranked keyword search with filters (availability, branch, format, Dewey class, language) and sorting.
- Record pages with availability per branch and due dates, and placing holds.
- **My account**: loans with online renewal, holds with queue position, fines, reading history, messages,
  contact details and password change.

## Project structure
```
backend/
  prisma/schema.prisma        Database schema (all modules)
  prisma/migrations/          SQL migrations
  prisma/seed.ts              Reference data, demo accounts and demo catalog
  src/lib/                    ISBN, MARC 21, call numbers, rules, settings, counters, search text (+ unit tests)
  src/modules/circulation/    Circulation engine (checkout, checkin, renew, holds, fines, routing)
  src/modules/<module>/       Routes per feature: catalog, patrons, holds, fines, transfers, inventory,
                              acquisitions, serials, reports, notices (+ scheduled jobs), settings, audit, opac
frontend/
  src/components/             Layout, UI kit, scanner input, pickers, charts, barcode, dialogs
  src/pages/                  circulation/, catalog/, patrons/, collection/, admin/, opac/
```

## Key concepts
- **Biblio vs item**: a *biblio* is one title/edition (ISBN, title, authors, classification, MARC data). An
  *item* is a physical copy with its own barcode, branch, call number and status.
- **Branches**: each copy has a *home* branch (owner) and a *current* branch (where it is). Staff choose their
  working branch in the header; checkouts, returns and the hold shelf use it.
- **Overrides**: when a rule blocks an action, staff see the reasons and may override; the override is audited.
