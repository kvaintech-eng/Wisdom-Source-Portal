# Production-readiness checklist

## Current decision

**NO-GO for real student data and production sign-in.** This document is a readiness gate, not a security certification or approval to launch. `VITE_AUTH_ENABLED=true` now enables sign-in in production builds as well as development; keep it false in deployment previews and do not enable it on a public production deployment until the intended origin, Supabase Auth redirects, and Edge Function CORS are configured.

The administrator has directed that the existing staging Supabase project (`gpyybjbcpgvvinrlmmnv`) be promoted for production use because the Free plan limits the account to two projects. This avoids requiring a third project, but removes the separate staging environment. The Vercel deployment is available at `https://wisdom-source-portal.vercel.app`; its production URL is configured as the Edge Function `PORTAL_ORIGIN`. The administrator reports completing Vercel and Supabase Auth URL configuration, and the live page displayed the sign-in form on 2026-10-28. Successful account sign-in and end-to-end authorization have not been independently verified.

The administrator reports that hands-on testing of the current workflows in the development environment is complete. The 43 pgTAP assertions have been reported passing against both development and staging. These reports are useful evidence, but they do not replace a recorded acceptance matrix, staging role-based workflow tests, or an independent review of the fixes and deployment configuration.

## 1. School decisions and operational ownership

- [ ] Name the accountable school owner, portal administrator, technical operator, privacy contact, and incident contact.
- [ ] Approve which roles may create accounts, link a parent to a learner, reset credentials, publish results, correct attendance, promote learners, archive learners, and read audit history.
- [ ] Approve parent/guardian identity and relationship verification steps before account linking.
- [ ] Decide how students and parents will maintain a verified recovery contact. Until then, document the supervised administrator-reset process; do not enable recovery to an unverified address or phone number.
- [ ] Approve data-retention, archival, correction, deletion, and legal-hold rules. The application must not automatically purge archived records before these rules exist.
- [ ] Document safe, private delivery and acknowledgement of one-time temporary credentials.
- [ ] Document school procedures for the features not implemented, including fees/payments and student/parent self-service password recovery.
- [ ] Agree and record recovery-point and recovery-time objectives (RPO/RTO); do not assume defaults.

## 2. Independent security, privacy, and release review

- [ ] Have a reviewer independent of implementation inspect the release-candidate migrations, RLS policies, database functions, Edge Functions, Auth settings, and Storage policies. Include verification that earlier findings were fixed in the deployed candidate.
- [ ] Review authentication and authorization paths for each role, including first-login password change, session invalidation, deactivation, parent-child links, account provisioning/reset, and administrator MFA options.
- [ ] Review abuse protections and failure behavior for public ID login, including rate limits, generic error responses, CORS/origin policy, and secret handling.
- [ ] Verify that no service-role key, temporary password, access token, or unnecessary student information appears in frontend assets, browser logs, source control, analytics, or support logs.
- [ ] Have the school review applicable Nigerian privacy and children's-data obligations and document its lawful basis, notices, access/correction process, incident handling, and any required registrations or assessments.
- [ ] Record findings, severity, owner, remediation, and retest evidence. No unresolved critical/high issues may be accepted for launch without a documented decision by the accountable school owner and qualified reviewer.

## 3. Separate environments and deployment controls

- [ ] Keep development, staging, and production in separate Supabase projects; verify each project reference before running any linked command.
- [ ] Use fictional data only in development/staging. Do not copy production student records into lower environments.
- [ ] Confirm the production frontend build uses only its production Supabase URL and publishable/anon key. Keep all service-role, HMAC, and other privileged secrets in the managed server-side secret store.
- [ ] Keep Auth self-signup disabled. Configure the exact production site URL and redirect allowlist; remove localhost and preview URLs from production.
- [ ] Configure production Edge Function secrets for each function that needs them. Confirm `PORTAL_ORIGIN` matches the production site and that login HMAC/service-role secrets are unique to production. Never paste secret values into chat, source files, screenshots, or shell history.
- [ ] Create the first Super Admin through a trusted, reviewed process. Verify the account's email, role mapping, MFA policy, recovery route, and emergency ownership before enabling sign-in.
- [ ] Confirm private Storage buckets, file-size/type limits, signed-link expiry, CORS, database network restrictions where available, Auth rate limits, and alerting match the approved design.
- [ ] Store build artifacts and deployment approvals with the exact source revision and migration set. Protect production deploy credentials and require a second-person review for production changes.
- [ ] Keep `VITE_AUTH_ENABLED=false` in deployment previews. Enable it only on the intended production deployment after confirming the production-only Supabase URL and publishable key, exact site origin, Auth redirects, and Edge Function CORS; retain the opt-in flag and never expose privileged secrets to the frontend.

## 4. Database and security-test release gate

- [ ] Review the migration diff and linked project's migration history before applying changes. Apply schema changes only through reviewed, versioned migrations.
- [ ] Run typecheck, lint, unit tests, and production build against the release candidate; archive the outputs with the release evidence.
- [ ] Run the complete pgTAP/RLS suite against a disposable local or staging database as the privileged test runner. The suite must finish with its expected assertion plan and a rollback; never weaken school-table grants or policies just to make tests pass. `supabase test db` uses a local Docker/Podman runner; if that is unavailable, run the complete test file in the staging SQL editor as `postgres`, confirm the output contains the full expected assertion plan, and confirm the file's transaction rolls back.
- [ ] Repeat the relevant negative access tests against staging for anonymous callers, student, parent, and Super Admin roles. Include drafts versus published reports, cross-family access, parent links, serial immutability, session cutoff, provisioning authorization/rollback, and private Storage access.
- [ ] Confirm the production migration list matches the reviewed release before promotion. After applying migrations in staging, re-run smoke tests and confirm the production backup is available before any production schema change.
- [ ] Keep evidence of the reported 38-test development run, then run and record the release-candidate suite again. Do not describe a user-reported result as an independently verified review.

## 5. Backup and restore rehearsal

- Initial proposed school recovery targets were RPO up to 1 hour and RTO up to 4 hours. The administrator reports that the school has been informed of the Free-plan backup limitation and prefers Free for now, with a possible later upgrade. Supabase Free does not provide automatic database backups. This is a reported risk decision, not a verified backup design or restore rehearsal; the school must document an acceptable revised RPO, approve it explicitly, and define/rehearse exports, off-site retention, monitoring, and restore procedures before production data is entered.
- [ ] Confirm the selected Supabase plan's backup schedule, retention, point-in-time recovery availability, restore process, and associated costs. Record these against the school's approved RPO/RTO.
- [ ] Confirm exactly what the chosen backup covers. Do not assume a database backup also preserves Storage object bytes, Edge Function code, secrets, Auth/provider settings, redirect URLs, or frontend configuration.
- [ ] Define a separate, encrypted, access-controlled backup/export process for any required material not covered by the managed backup. Restrict access and verify that exported files are not placed in the repository or an unapproved device.
- [ ] Rehearse a restore into a separate non-production project using fictional/test data. Verify schema/migrations, representative records, Auth/account behavior, RLS policies, private Storage objects, and application connectivity.
- [ ] Measure the restore duration and data-loss window. Record the operator, date, outcome, issues, and corrective actions; repeat until the approved RPO/RTO is met.
- [ ] Document who can authorize a restore, where recovery credentials are held, how to prevent writes during recovery, and how to reconcile activity after the restore point.

## 6. Acceptance evidence and go/no-go

- [ ] Maintain a dated test matrix with role, scenario, expected outcome, actual outcome, tester, and evidence reference. Include sign-in/sign-out, password change/reset, account provisioning, enrollment, parent linking, attendance and correction, academic setup, grading, result import/publication/correction, report access/printing, timetable upload/download, announcements/calendar, audit history, promotion, archive, and session invalidation.
- [ ] Test with fictional accounts for every role in staging. Verify both allowed and denied actions; a successful UI path alone is not proof of an authorization boundary.
- [ ] Confirm all known product limitations have an approved operating procedure and are communicated to users.
- [ ] Confirm monitoring, alert ownership, incident escalation, support contacts, maintenance windows, rollback steps, and a tested account lockout/revocation process.
- [ ] Obtain written approval from the accountable school owner, independent reviewer, and technical operator. Attach the reviewed release identifier, migration list, test evidence, backup-rehearsal result, known limitations, and any accepted residual risks.
- [ ] Only after the approvals above, build with production-only public configuration, enable production authentication, and authorize real records. Start with a controlled pilot and monitor it before wider use.

## Evidence record

Keep release evidence in the school's approved, access-controlled location; do not store real student data, credentials, or secret values in this repository.

| Evidence | Reference / date | Owner | Outcome |
|---|---|---|---|
| Local release-candidate checks | Typecheck, lint, build, and 56 unit tests run successfully on 2026-10-28; build emitted a non-blocking large-chunk warning; source revision not recorded | Not assigned | In progress |
| Independent security/privacy review and retest | Not recorded | Not assigned | Pending |
| Staging migrations and RLS/pgTAP | All 13 migrations applied to staging; 43 assertions reported passing by administrator on 2026-10-28 | Not assigned | In progress — role acceptance pending |
| Staging Edge Functions and secrets | On 2026-10-28, all four functions (`login-by-id`, `provision-account`, `change-password`, `reset-account-password`) deployed and verified ACTIVE on staging; `PORTAL_ORIGIN` and `LOGIN_ID_HASH_SECRET` are configured (values excluded). Administrator declines further fictional-account testing; role-based smoke tests remain incomplete. | Not assigned | In progress — role acceptance pending |
| Production project and deployment target | Existing staging project (`gpyybjbcpgvvinrlmmnv`) designated for production; Vercel URL `https://wisdom-source-portal.vercel.app` verified to load, and configured as Edge Function `PORTAL_ORIGIN`. Administrator reports Vercel variables and Supabase Auth URL configuration complete; live sign-in form displayed. Actual authentication and role authorization not independently verified. | Not assigned | In progress — first-admin sign-in and operational review pending |
| Backup coverage and restore rehearsal | Administrator reports school informed and Free preferred for now; no automated backups, export schedule, or restore rehearsal verified | Not assigned | **Blocked — risk acceptance and recovery procedure required** |
| School operational and privacy approvals | Not recorded | Not assigned | Pending |
| Production go/no-go approval | Not recorded | Not assigned | **NO-GO** |
