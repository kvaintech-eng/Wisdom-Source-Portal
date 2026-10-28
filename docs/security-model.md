# Initial security model

## Scope

This is an in-progress application foundation, not a production security certification. Sign-in is off by default and must stay off until launch gates are complete and approved. The 38 assertions in `supabase/tests/rls_access.sql`, including regression checks for report-snapshot confidentiality, have been reported passing against the linked development database after the latest security migration. This is an initial RLS test suite, not independent security certification or proof that every workflow is secure. The administrator reports hands-on testing of the current workflows is complete; release-candidate evidence, independent security/privacy review and retesting, and operational recovery rehearsal remain pending. Do not enter real student information before the remaining controls below are reviewed.

The administrator reports that hands-on testing of the current workflows in development is complete. This does not replace a documented release-candidate test record, independent review and retest, or backup/restore rehearsal. Production remains **NO-GO** until the [production-readiness checklist](production-readiness.md) is completed and approved.

The frontend enables portal authentication only when Supabase is configured and `VITE_AUTH_ENABLED` is exactly `true`. This opt-in works in development and production builds; keep it false in deployment previews and enable it only on the intended site after configuring its Auth redirects and Edge Function CORS.

## Trust boundaries

- The browser is untrusted. Its route, selected student, class, session, mark, role, and publication state are never authorization inputs.
- Supabase Auth verifies credentials and supplies the authenticated user ID to Postgres.
- `user_accounts` assigns each Auth user exactly one server-managed role. Browser users have SELECT permission only; provisioning code must create or deactivate this mapping in a trusted server-side workflow.
- PostgreSQL Row Level Security is the data-access boundary. Hiding a screen or button is not authorization.
- The Supabase service-role credential is server-only. It is not a Vite environment variable and must never appear in browser code.
- Timetables live in a private Storage bucket. A signed-in student or parent can access only a timetable associated with an active enrollment in the active academic session.

## Current access controls

- Unauthenticated callers have no grants on school records.
- Student record access requires an active student-role account mapped to that learner.
- Parent access requires an active parent-role account and an active, verified parent-child relationship. The relationship is checked in database authorization, not just by the client.
- Administrative policies require an active Super Admin account.
- Deactivation disables application queries even if an old Auth token remains valid. The eventual account-management workflow must additionally revoke sessions where supported.
- Student/parent login IDs are HMAC-hashed before server-side lookup. The login throttle stores only this keyed hash, never the raw identifier. The server-only HMAC key and service-role key must stay in Edge Function secrets.
- Student/parent account provisioning is restricted to an active Super Admin session. It creates a random Auth password, stores the ID mapping and learner/parent records transactionally, attributes the database audit event to the authorizing administrator, and returns the temporary password once. The account must change it at first sign-in. Transfer that credential only through a secure out-of-band process.
- Administrator email sign-in verifies the active `super_admin` role after Auth credential verification; a valid password alone does not grant portal access.
- The password-change Edge Function accepts only the authenticated user's own session and uses trusted Auth admin APIs to change that password and clear the server-managed first-login flag.
- Password resets are restricted to an active Super Admin, target active student/parent accounts by a server-side HMAC lookup, require a reason, and create an audit record. A reset issues a one-time temporary password and requires a password change at the next sign-in.
- Email-based password recovery is limited to administrator accounts with a registered email. ID-based student and parent accounts use the audited school-admin temporary-password reset process because their Auth identities use non-deliverable internal addresses.
- Administrative audit history is readable only by active Super Admin accounts through the existing RLS policy, is paginated read-only in the client, and cannot be modified or deleted by browser roles.
- RLS role resolution rejects Auth tokens older than the account's session-invalidation cutoff and tokens marked as requiring a password change. The credential workflow records the cutoff before updating Auth, so an Auth failure remains fail-closed. This also blocks direct PostgREST/Storage-policy access while a temporary password is in force.
- Privileged account-provisioning and password-reset Edge Functions validate the signed access-token subject, forced-password-change flag, and issuance time against the same account session cutoff before acting.
- Attendance saves, result imports/publication, calendar/settings changes, announcements, promotion/archive, and timetable publication use privileged database functions. Direct browser writes to protected tables are revoked.
- Result CSV files and the first XLSX worksheet are previewed and validated in the browser against the selected active enrollments and latest assessment schema before submission; database functions independently verify rows, maxima, duplication, corrections, and publication completeness.
- Results and report cards are visible to students and linked parents only after publication. Draft results, result imports, finalization data, promotion decisions, and audit history are admin/server-only.
- Class-wide finalization snapshots are administrator-only; students and parents receive only their own published report-card snapshot.
- Permanent student serials are unique and immutable. Student rows cannot be deleted to recycle a serial.
- Attendance uniqueness is enforced per enrollment and date. Edits require an administrator, a reason, and an audit-log entry; deletes are denied.
- Published results and report-card snapshots are immutable. Result marks are checked against the configured assessment maxima by a database trigger.
- Private timetable uploads accept only PDF, PNG, or JPEG files up to 10 MiB.
- Payments have no schema integration or payment-gateway workflow in this milestone.

## Required next controls

1. Complete role-scoped workflows for self-service account recovery and any further school-specific requirements; review the new academic configuration, grading-scale, report-history, timetable, school-settings, report-print, and promotion/archive workflows in an isolated Supabase project.
2. Decide how student/parent accounts can provide and verify a deliverable recovery contact before implementing their self-service recovery; build an approval-controlled account reactivation workflow. Account deactivation and credential updates invalidate old JWT access at the RLS layer; verify Auth refresh-token revocation behavior as part of deployment tests. Do not send temporary credentials or student information through an insecure channel.
3. Expand database/RLS coverage for provisioning authorization and rollback, parent linking, role escalation, drafts versus published results, and private file access. Keep fictional test accounts and records only.
4. Review audit coverage and retention, including account lifecycle, settings, publications, promotion, and archive. Never log passwords, access tokens, or unnecessary student data.
5. Obtain independent review of the migrations, Edge Functions, and policies. Test in separate development/staging projects, perform backup/restore rehearsal, and review applicable Nigerian privacy and children's-data obligations before launch.

## Data retention

Retention periods, permanent-deletion approval, and legal holds are not specified by the school yet. Until approved, the application must not automatically purge archived academic records. Document the school's approved schedule and deletion authority before adding a purge operation.
