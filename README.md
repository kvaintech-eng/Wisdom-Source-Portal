# Wisdom Source School Portal

A secure, serverless school portal for Wisdom Source School, built to replace the supplied Version 8 HTML demo with a maintainable React application and a Supabase/PostgreSQL backend.

## Current status

This repository contains a responsive sign-in screen, server-side ID and administrator authentication, trusted individual and CSV-bulk student/parent provisioning with first-login password change, an administrator dashboard with operational summary and section navigation, and a role-scoped student/parent workspace with overview, results, attendance, timetable, calendar, and school-notice sections. School operations include a searchable, session-wide admin student directory with class filters, attendance entry, student/parent password reset, administrator email recovery, school details, academic session/term management, versioned grading scales, subject and assessment setup, CSV/XLSX result import and publication, promotion decisions and learner archiving, timetable upload/publication with private family downloads, and a read-only administrative audit history. Administrators can review publication revisions and report snapshots. **Authentication is off by default and the application is not ready for operational use or real student data.** Student/parent self-service recovery is unavailable because their school accounts do not have deliverable email addresses. Fees/payments are not implemented. Release-candidate acceptance evidence, independent security/privacy review and retesting, and operational recovery rehearsal remain unfinished. Keep `VITE_AUTH_ENABLED=false` until those gates are complete and approved.

The administrator reports completing hands-on testing of the current workflows in the development environment. This does not constitute production approval: independent security/privacy review and retesting, documented release-candidate acceptance, and backup/restore rehearsal remain launch gates. Use the [production-readiness checklist](docs/production-readiness.md) to record evidence and decisions; the current production decision is **NO-GO**.

Portal authentication requires a configured Supabase client and the exact `VITE_AUTH_ENABLED=true` flag in either development or production builds. Keep the flag false in deployment previews and enable it only for the intended production deployment after configuring the production site origin, Auth redirects, and Edge Function CORS.

The login Edge Function resolves student/parent ID mappings server-side, applies per-ID throttling, and returns a Supabase Auth session only after password verification and role validation. `provision-account` is restricted to an active Super Admin and creates student/parent records transactionally through the database RPC; its generated temporary password is returned once and must be handed to the account holder through a secure, out-of-band channel. First login is gated in both the interface and RLS: database role resolution rejects tokens marked for a password change or older than the account's session-invalidation cutoff. Password changes and admin resets invalidate existing sessions before updating Auth credentials, failing closed if the session gate is unavailable. All 38 pgTAP RLS assertions, including new checks that students and parents cannot read class-wide report snapshots, have been reported passing against the linked development database. Do not enter real credentials or student records until the remaining workflows and controls have been independently reviewed and accepted.

## Technology

- React, TypeScript, and Vite for a static frontend.
- Supabase Auth, PostgreSQL with Row Level Security, and private Storage for managed backend services.
- Vitest domain tests and pgTAP checks for database access boundaries.
- No service-role key or real school data belongs in the frontend or repository.

## Start developing

Requirements: Node.js 22 or newer, npm, and the Supabase CLI.

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local`; add only the local Supabase URL and publishable key.
3. Start local Supabase with `supabase start`.
4. Apply migrations with `supabase db reset`.
5. Start Vite with `npm run dev`.
6. Run the domain tests with `npm test`.
7. Use `npm run typecheck`, `npm run lint`, and `npm run build` before sharing changes.
8. Run database/RLS tests with `supabase test db` against the local development database.

The migrations seed only agreed school configuration (school name, 17 distinct class groups, and default grading bands). They do not seed learners, login accounts, attendance, fees, or school activity. Configure an isolated development project and create only fictional test accounts.

### Result import CSV/XLSX format

The admin portal provides a header-only CSV template. CSV files and the first worksheet in an XLSX workbook use the same columns. Add one learner/subject row per result using the exact configured subject name and permanent student serial:

```csv
serial,subject,ca,exam
WIS-001A,English Language,24,63
```

The example serial is fictional. Preview validates that each learner is enrolled in the selected class/session, each subject is configured for that term, marks are within the current assessment maxima, and no learner/subject pair is duplicated. Files are limited to 2 MiB and 10,000 result rows. All rows must pass validation before a draft import is submitted; import replacement and published-score corrections require explicit confirmation/reason. Optional teacher comments are included in the immutable report snapshot. Publishing checks completeness against every active learner and configured subject; a correction creates a new revision while prior report cards remain available in publication history.

### Student account CSV enrollment

The administrator's **Students & families** section accepts a CSV with the exact header `full_name,gender,class_name`; gender may be blank or `female`, `male`, or `undisclosed`. Each row may target a different active class. Class names are matched case-insensitively against the configured class list. The selected academic session applies to the entire batch. The import is limited to 1 MiB and 100 students, and every row must validate before provisioning begins. Each account is created through the same authenticated server-side provisioning function as individual enrollment and is assigned a permanent serial for the class specified on its row and the selected session.

Provisioning is sequential and each account commits independently; the batch is not atomic. If a request fails or its result cannot be confirmed, processing stops. Check the student roster and administrative audit history before retrying, because the server may have created the account even if the browser did not receive its response. One-time credentials are held only in the current page session and can be downloaded as a JSON file after an explicit warning. Store that file only in an approved secure location, transfer credentials privately, and securely delete the file when it is no longer needed. Closing or refreshing the page clears credentials from the interface; they cannot be retrieved there later.

## Security and launch gates

- Every application table has Row Level Security enabled. Unauthenticated users receive no application data.
- A user account's role is stored in a server-managed table; clients cannot insert or change their own role.
- Student access is restricted to the authenticated student; parent access requires an active, verified relationship on every query.
- Published reports are snapshots and immutable. Published result rows reject update/delete; corrections must be explicit revisions.
- Timetable files remain in private storage and are accessible to active Super Admins or authenticated families with a current enrollment in the timetable's class. Published timetables are served using short-lived signed download links.
- Student serials are unique, permanent identifiers, not passwords.
- Audit history is append-only; attendance corrections require a reason and leave a before/after audit entry.
- Fees and payments are not implemented.
- Never add production secrets or real student data to `.env`, seed files, logs, or screenshots.

Before real data is entered, finish the remaining account-recovery workflow; test account provisioning, serial/parent-ID authentication, session revocation on deactivation, academic session/term and grading configuration, assessment settings, transactional attendance and result workflows, private file access, audit logging, and negative RLS cases. Have a qualified human review the security model and the school's privacy obligations before launch.

## Supabase environment

Use separate development and production Supabase projects. Apply schema changes through versioned migrations; do not hand-edit the production schema. The public frontend environment contains only the project URL and publishable key. The service-role key, when needed by future Edge Functions, belongs only in managed server-side secrets.

Production deployment, real-data imports, and live credentials are intentionally not configured.

The ID login Edge Function also requires server-side `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `LOGIN_ID_HASH_SECRET` (at least 32 bytes), and `PORTAL_ORIGIN` secrets. Set them only through Supabase Edge Function secrets; never add them to `.env.local`, Vite variables, source control, or frontend configuration.

The `provision-account` and `change-password` Edge Functions also require `SUPABASE_SERVICE_ROLE_KEY` and `PORTAL_ORIGIN`; provisioning and `reset-account-password` additionally require `LOGIN_ID_HASH_SECRET`. Keep all of these values in Supabase Edge Function secrets. Account creation/reset returns the temporary password to the authenticated administrator once; do not persist it, log it, or send it over an insecure channel. Administrator identities must be created through a trusted setup process and assigned the `super_admin` role in `user_accounts`.
