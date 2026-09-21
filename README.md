# Rabotec Fleet & Safety

Responsive vehicle roadworthy certificate and insurance tracking application.

## Features
- Five fleet categories: Light Vehicles (LVs), Dump trucks (DTs), Articulator dump trucks (ADs), Service Trucks, Lowbeds.
- Shared D1 database, authenticated API, duplicate-registration checks and optimistic concurrency protection.
- Add/edit vehicles, certificate and policy identifiers, expiry dates, responsible person, location and notes.
- Date-based dashboard and renewal queue, missing-record detection, searchable register, CSV export and reversible archive.
- Transactional audit history records previous and new values. The interface displays the latest 200 events.
- Read-only sample fleet is separate from real records.

## Operations
The Sites access policy controls authorized viewers. Initially the deployment is owner-private. Invite approved staff through Sites sharing before department rollout; application users admitted by that policy have the same editing access. Do not make this fleet public. There are no administrator/viewer roles inside the application.

Dates use UTC (Ghana). Expiry day remains current and is included in the renewal queue. Status priority is expired, missing, due within 30 days, then valid. Coverage includes unexpired documents due soon. Metrics assess recorded dates, not independent verification of document authenticity or legal compliance.

Notifications are in-app only. Email/SMS delivery, document uploads, bulk import and scheduled reminders are not implemented. CSV export reflects the current register filters. Keep periodic exports as an operational backup; CSV is not a database restore feature.

## Development
Node 22.13+; npm lockfile is authoritative. Install with `npm run install:ci`; use `npm run dev`, `npm run build`, and `npm run db:generate`. The supplied runtime lacks an npm shim; the implementation used a registry npm CLI via pnpm and ran `node scripts/run-framework.mjs build` directly.

Generate Drizzle migrations after schema edits. Apply pending migrations to the local DB with the command documented in the Sites starter README; deployment applies production migrations. Never edit an applied migration.

## Validation
- `node --experimental-strip-types tests/fleet.test.mjs`: 13 checks for expiry boundaries, missing dates, status precedence, leap years and CSV formula escaping.
- `node --experimental-strip-types tests/api.test.mjs`: local-only integration checks for creation/readback, renewal, duplicate registration, stale update conflict, archive and audit, authentication and invalid dates. Requires local development server. Creates archived QA records only in local storage.
- `node node_modules/typescript/bin/tsc --noEmit`

API writes require sign-in and same-origin requests. Parameterized SQL handles input; audit and record writes share a transaction. No sample or QA records are seeded into production.
