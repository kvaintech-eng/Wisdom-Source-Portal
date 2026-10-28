# Initial application architecture

## Runtime

The frontend is a statically deployable React + TypeScript + Vite application. Supabase provides managed Auth, PostgreSQL, private file storage, and privileged Edge Function/database-function workflows. No custom always-on application server is introduced.

The browser Supabase client accepts only the project URL and publishable key. Database policies enforce row access. Service-role operations, account provisioning, serial-to-auth mapping, password changes, and publication workflows remain on the trusted server/database boundary. The `login-by-id` Edge Function has JWT verification disabled because it creates sessions; `provision-account` and `change-password` require an authenticated JWT and authorize the caller server-side.

`provision-account` issues an unguessable parent login ID or database-allocated student serial, creates a random-password Auth user, and records the corresponding HMAC login mapping and school records through a restricted RPC. It returns the one-time temporary password only to the requesting Super Admin; server-managed Auth metadata requires a password change at first sign-in. Password changes and administrator resets invalidate existing JWT access before changing Auth credentials; RLS also denies sessions marked for a forced password change. `reset-account-password` permits only an active Super Admin to issue a replacement temporary password to an active student/parent account, requires a reason, and records the reset attempt in the audit log.

## Current schema areas

- Identity and lifecycle: `user_accounts`, `students`, `parent_accounts`, `parent_student_links`
- Academic structure: `academic_sessions`, `academic_terms`, `classes`, `enrollments`
- School operations: `school_settings`, `school_calendar_events`, `attendance_records`, `timetable_documents`, `announcements`
- Assessment and reporting: `subjects`, `assessment_schemas`, `grading_bands`, `result_import_batches`, `results`, `class_result_finalizations`, `published_report_cards`
- Administration: `promotion_decisions`, `audit_logs`
- Provisioning and login: private `portal_login_identities` and `portal_login_rate_limits`

The initial database migrations and security notes are under `supabase/migrations/` and `docs/`. The current UI supports Super Admin student and parent account creation, school details, academic session/term management, versioned grading scales, daily attendance, subject/assessment setup, validated CSV/XLSX result import/publication, teacher comments, report-publication history, promotion decisions, learner archiving, private timetable upload/publication, and read-only administrative audit history. Administrator email recovery is available for accounts with verified deliverable emails. Student/parent views include published report cards with print support, short-lived private timetable downloads, announcements, and calendar items. Other database tables and RPCs do not imply their UI workflows are complete; the README lists the current implementation boundary.
