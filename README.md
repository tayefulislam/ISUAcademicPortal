# ISU Academic Portal

A full academic management platform for a single institution: students find
and search course materials, submit assignments, take quizzes/exams, message
faculty, and get real-time notifications (in-app + push) — while
Faculty/Admin/Super Admin manage content, grading, enrollment, and the
institution's users and settings from role-scoped dashboards.

**Stack:** React 18 (Vite) + Tailwind · Node.js/Express · MongoDB/Mongoose ·
JWT auth · pluggable file storage (local disk / S3-compatible / Uploadcare) ·
Web Push (VAPID) + installable PWA · Google Analytics 4 · Microsoft Clarity
(optional, consent-gated behavioural analytics — see
[`docs/CLARITY_ANALYTICS.md`](docs/CLARITY_ANALYTICS.md)).

---

## Table of Contents

1. [Feature Overview](#1-feature-overview)
2. [Roles & Access Model](#2-roles--access-model)
3. [Project Structure](#3-project-structure)
4. [Getting Started](#4-getting-started)
5. [Environment Variables](#5-environment-variables)
6. [Database Models](#6-database-models)
7. [API Reference](#7-api-reference)
8. [Smart Notification System](#8-smart-notification-system-in-app--pwa-push)
9. [Typo-Tolerant Search Engine](#9-typo-tolerant-search-engine)
10. [File Storage Architecture](#10-file-storage-architecture)
11. [Progressive Web App (PWA)](#11-progressive-web-app-pwa)
12. [In-App User Manual](#12-in-app-user-manual)
13. [Automated Tests](#13-automated-tests)
14. [Security Notes](#14-security-notes)
15. [Known Limitations](#15-known-limitations--next-steps)
16. [Deployment](#16-deployment)
17. [Document Generator](#17-document-generator)

---

## 1. Feature Overview

**Content & Materials**
- Department/Course/Batch/Semester-scoped file uploads with fine-grained
  visibility rules (public vs. login-required, restricted to specific
  departments/batches/semesters/courses).
- Multi-file grouped uploads (one entry, many attachments), file versioning
  (replace with history), and student self-submission with a Faculty/Admin
  review-and-approve queue.
- Chapters/Topics for organizing materials within a course.
- Typo-tolerant fuzzy full-text search across the whole file catalog (see
  [§9](#9-typo-tolerant-search-engine)).

**Assessments**
- **Assignments** — targeted by department/course/batch/semester, file/text/
  both submission types, deadlines with late-submission handling, per-student
  grading with marks + feedback.
- **Question Bank** — MCQ/true-false/numerical/matching/long-answer
  questions, tagged by difficulty and topic, with the same fuzzy search
  engine for finding a question fast.
- **Quizzes/Exams** — fixed hand-picked question lists *or* random selection
  (N questions per rule, by course/difficulty/tags, sized fresh per
  student), timed attempts with autosave and auto-submit on timeout,
  automatic MCQ/numerical/matching grading, manual grading for long-answer
  questions, negative marking (quiz-level or per-question override), and
  **Public Exams** — link-shareable, no-login guest attempts for open
  tests/competitions.

**Communication**
- Direct Faculty↔Student messaging, scoped to a Faculty member's assigned
  department/course.
- Institution-wide Notices (targeted by department/course/batch/semester, or
  "everyone").
- Broadcast Email Center (SMTP/Resend/console-log providers) with delivery
  logs.
- Course Enrollment requests (retake/extra/backlog/improvement/advance) with
  a Faculty approval workflow.

**Smart Notifications** ([§8](#8-smart-notification-system-in-app--pwa-push))
- Automatic in-app + Web Push notifications the moment relevant content is
  created/updated/graded — new materials, assignment/exam results, notices,
  messages, enrollment decisions — sent only to the students/faculty it
  actually concerns, never a blind broadcast.
- Per-user notification preferences (per type, plus push/email channel
  toggles), a notification center with read/unread state, and a Super Admin
  broadcast tool for ad-hoc announcements.

**Governance**
- Four fixed roles (`student`, `faculty`, `admin`, `super_admin`/
  `administrator`) plus **custom admin-tier roles** (e.g. "CR") that Super
  Admin can create with a hand-picked subset of permissions (Files, Notices,
  Assignments, Question Bank, Quizzes, Messages, Emails, Enrollments,
  Notifications).
- System-wide feature toggles (Settings) to turn entire subsystems on/off:
  messaging, email, student uploads, student ID approval, course enrollment,
  quizzes, OTP email verification.
- Student ID photo approval workflow, globally unique Roll No/Student ID
  enforcement, and blocked/active account status separate from that
  approval gate.
- Role-specific in-app **User Manuals** ([§12](#12-in-app-user-manual)).

---

## 2. Roles & Access Model

| Role | Summary |
|---|---|
| `student` | Browses/searches materials, submits assignments, takes quizzes/exams, messages Faculty, requests course enrollment, manages their own notification preferences. |
| `faculty` | Everything a student's dashboard doesn't cover, scoped to their `assignedDepartments`/`assignedCourses`: upload materials, review student submissions, create notices/assignments/quizzes, grade, message their students, send broadcast emails, approve enrollment requests. |
| `admin` | Same modules as Faculty, institution-wide (not scoped to an assignment) — file management, approvals, review queue, notices, assignments, question bank, quizzes, messaging, email, enrollment. |
| `super_admin` / `administrator` | Everything Admin can do, plus user management, Faculty account management, custom role/permission management, system-wide settings, feedback review, and the Admin Notification broadcast/stats tool. `administrator` has every `super_admin` capability except visibility/control over `super_admin` accounts themselves. |
| *custom admin-tier role* (e.g. `CR`) | Created by Super Admin via **Roles & Permissions**; behaves like a scoped-down Admin — sees exactly the modules it's been granted. |

Every protected route re-verifies the requester's role/status against the
database on each request (never trusts the JWT payload alone) — see
`server/src/middleware/auth.js`.

---

## 3. Project Structure

```text
isucloud/
├── client/                          React frontend (Vite)
│   └── src/
│       ├── analytics/                 clarity.js (the only Microsoft Clarity integration point)
│       ├── api/                       axios instance + one typed *Api object per resource (endpoints.js)
│       ├── components/
│       │   ├── exam/                    AnswerInput, ResultView, useCountdown
│       │   └── notifications/           NotificationBell/Dropdown/List/Item, EnableNotificationPrompt
│       ├── context/                   AuthContext, ToastContext
│       ├── data/                      manualContent.js (in-app User Manual copy)
│       ├── hooks/                     useDebouncedValue, useDownloadFile, useNotifications
│       ├── layouts/                   MainLayout, DashboardShell (+ Admin/SuperAdmin/Faculty wrappers)
│       ├── pages/                     Home, SearchResults, Dashboard, Manual, admin/, superadmin/, faculty/, shared/, public/
│       ├── sw.js                      custom service worker source (push + notificationclick handlers)
│       └── utils/                     format.js, analytics.js, push.js
├── server/                          Express backend
│   └── src/
│       ├── config/                    env.js, db.js
│       ├── controllers/               one per resource — auth, files, notices, assignments, questions,
│       │                              quizzes, publicExams, messages, emails, courseEnrollment, roles,
│       │                              notifications, adminNotifications, superAdmin, ...
│       ├── middleware/                auth (authenticate/requireRole/requirePermission), upload, validate, errorHandler
│       ├── models/                    User, Department, Course, Batch, Semester, Category, Chapter, Topic,
│       │                              File, Notice, Assignment, Submission, Question, Quiz, QuizAttempt,
│       │                              Conversation, Message, EmailLog, CourseEnrollment, Role, Notification,
│       │                              PushSubscription, Feedback, Settings, RoutineTemplate,
│       │                              ScheduleInstance, AcademicEvent
│       ├── routes/                    REST route definitions, one file per resource
│       ├── services/
│       │   ├── storage/                 storageService.js (the ONLY module the app talks to for files),
│       │   │                            localStorage.js, s3Storage.js, uploadcareStorage.js
│       │   ├── email/                   emailService.js + smtp/resend/console providers + templates
│       │   ├── notifications/           notificationService.js, recipientResolver.js,
│       │   │                            notificationTemplates.js, pushService.js
│       │   ├── examEngine.js            shared grading/result engine for course quizzes AND public exams
│       │   ├── courseAccessService.js   single source of truth for "which courses can this student reach"
│       │   ├── routineService.js        recurring-rule materialisation + routine→occurrence sync
│       │   ├── academicEventService.js  the one "what can this person see / what is on now" reader
│       │   ├── reminderService.js       class/exam reminders, driven by the cron endpoint
│       │   ├── routineNotifications.js  who hears about a cancellation, a move or a routine change
│       │   └── fileQueryBuilder.js      shared search/filter/visibility query logic
│       ├── utils/                      seed.js, jwt.js, ApiError.js, fileTypes.js, textSearch.js (fuzzy search engine)
│       ├── test/                       dbTestUtils.js (disposable-DB helper for integration tests)
│       └── app.js
├── .env.example
└── package.json                     root scripts (dev, install:all, seed)
```

## 4. Getting Started

### Prerequisites
- Node.js 18+
- MongoDB running locally (`mongodb://127.0.0.1:27017`) or an Atlas URI

### Install & configure

```bash
git clone <repo-url> isucloud
cd isucloud
cp .env.example .env
npm run install:all
```

Edit `.env` and set at minimum:
- `MONGODB_URI`, `JWT_SECRET`
- A file storage provider (`FILE_STORAGE_PROVIDER=local` needs nothing else;
  `s3` needs the `S3_*` vars; Uploadcare needs `UPLOADCARE_*`)
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` if you want push notifications to
  actually deliver (generate a pair with `npx web-push generate-vapid-keys`
  — see [§8](#8-smart-notification-system-in-app--pwa-push)). Everything
  else works fine without these; in-app notifications never depend on push.

### Seed sample data (departments, courses, batches, categories, admin accounts)

```bash
npm run seed
```

Creates a `super_admin` (`SEED_SUPER_ADMIN_EMAIL`/`SEED_SUPER_ADMIN_PASSWORD`,
defaults `superadmin@university.edu` / `SuperAdmin@12345`) and an `admin`
(`SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`, defaults `admin@university.edu` /
`Admin@12345`) account. **Change both passwords after first login.**

### Run in development

```bash
npm run dev
```

Runs the API and frontend concurrently (ports come from `.env` — this
project's own dev setup uses `7050` for the API and `5160` for the client;
adjust `PORT`/`server.port`/`VITE_API_URL` if you use different ones). Or
run them separately:

```bash
npm run dev:server
npm run dev:client
```

### Build for production

```bash
npm run build:client   # outputs client/dist
npm run start:server   # node server/src/app.js
```

Serve `client/dist` with any static host/CDN (or behind the same reverse
proxy as the API) and point `VITE_API_URL` at the deployed API's `/api` URL.

---

## 5. Environment Variables

| Variable | Description |
|---|---|
| `NODE_ENV` | `development` \| `production` |
| `PORT` | API port |
| `CLIENT_URL` | Frontend origin(s), comma-separated — used for CORS |
| `MONGODB_URI` | MongoDB connection string |
| `TEST_MONGODB_URI` | Optional, tests only — the MongoDB the test suite runs against. Defaults to `127.0.0.1:27017`; point it at Atlas where there is no local server. Each file creates and drops its own `notif_test_*` database. |
| `JWT_SECRET` | Secret used to sign JWTs — must be long/random in production |
| `JWT_EXPIRES_IN` | Token lifetime, e.g. `7d` |
| `FILE_STORAGE_PROVIDER` | `local` \| `s3` — storage for documents |
| `UPLOAD_DIR` | Local upload root (only used when provider is `local`) |
| `MAX_FILE_SIZE_MB` | Per-file upload limit |
| `IMGBB_API_KEY` | For image uploads via the direct-upload path |
| `UPLOADCARE_PUBLIC_KEY` / `UPLOADCARE_SECRET_KEY` | Uploadcare widget (optional alternative upload path) |
| `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` / `S3_PUBLIC_URL` | S3-compatible storage (AWS S3, Cloudflare R2, Backblaze B2, DigitalOcean Spaces, MinIO) |
| `EMAIL_PROVIDER` | `smtp` \| `resend` \| `console` — falls back to `console` (logs instead of sending) if the selected provider is missing credentials |
| `EMAIL_FROM` / `EMAIL_FROM_NAME` | Sender identity for outgoing mail (OTP, password reset, broadcast emails) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | SMTP provider settings |
| `RESEND_API_KEY` | Resend provider API key |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push credentials — generate with `npx web-push generate-vapid-keys`; `VAPID_SUBJECT` is a `mailto:` contact address required by the Push protocol |
| `REMINDER_CRON_SECRET` | Shared secret for the class/exam reminder cron target (`POST /api/internal/reminders/run`). The endpoint refuses to run at all while this is unset, rather than being left open; pair it with an external cron hitting that URL every minute |
| `VITE_API_URL` | Frontend → backend base URL, e.g. `http://localhost:7050/api` |
| `VITE_GA_MEASUREMENT_ID` | Google Analytics 4 measurement ID (`G-XXXXXXXXXX`) |
| `VITE_CLARITY_PROJECT_ID` | Microsoft Clarity project ID (session recordings, heatmaps). Blank disables Clarity. See [`docs/CLARITY_ANALYTICS.md`](docs/CLARITY_ANALYTICS.md) |
| `VITE_CLARITY_ENABLED` | `false` switches Clarity off for one environment without removing the project ID (default `true`) |
| `VITE_UPLOADCARE_PUBLIC_KEY` | Enables the Uploadcare widget on upload pages |

---

## 6. Database Models

| Model | Purpose |
|---|---|
| `User` | Single flat schema for every role (`role` is a free string, not an enum — see Roles). Carries `department`/`batch`/`semester` (student placement), `assignedDepartments`/`assignedCourses` (faculty/admin-tier scope), `rollNo` (**globally unique Student ID**), `approvalStatus` (ID-photo gate), `status` (active/blocked), and `notificationPreferences`. |
| `Department`, `Course`, `Batch`, `Semester`, `Category`, `Chapter`, `Topic` | Core academic taxonomy everything else targets/filters by. |
| `File` | One searchable entry per upload (with `attachments[]` for multi-file groups and `versions[]` for replace history), visibility rules, and department/course/batch/semester scoping. |
| `Notice` | Announcements with OR-across-axes targeting (`everyone`, or any of departments/courses/batches/semesters). |
| `Assignment` / `Submission` | AND-across-axes targeting (File-restriction-style), per-student submissions with marks/feedback. |
| `Question` | Question Bank entries (MCQ/true-false/numerical/matching/long-answer), with `difficulty`/`tags` for random-selection quizzes and fuzzy search. |
| `Quiz` / `QuizAttempt` | Fixed or random-selection exams; an attempt snapshots its own `questionOrder` + `assignedMarks` so later quiz/question edits never retroactively change a finished attempt. Also backs Public Exams (`examType: 'public'`, guest attempts). |
| `Conversation` / `Message` | 1:1 Faculty↔Student direct messaging. |
| `EmailLog` | Broadcast email send history + per-recipient delivery status. |
| `CourseEnrollment` | The explicit student↔course access layer beyond department membership (retake/extra/backlog/improvement/advance), with a Faculty approval workflow. An access-granting enrollment (`active`/`approved`) of an *additional* type is also what lets that course's routine entries and calendar events reach the student even when they are scheduled for another batch/semester — see `audienceFilterFor`. |
| `Role` | Custom admin-tier roles and their granted permission keys. |
| `Notification` | In-app notification feed — one row per recipient per event, with a `{recipient, type, entityType, entityId, slot}` unique index for idempotency. `slot` is used by class/exam reminders (the offset plus the effective start instant), so one class legitimately produces several reminders and a moved class gets a fresh one instead of colliding with the reminder already sent for its old time. |
| `PushSubscription` | One row per subscribed browser/device per user. |
| `RoutineTemplate` / `ScheduleInstance` | The class routine: a recurring rule (the master) and the dated occurrences it generates. An occurrence stores the effective values plus `overriddenFields[]` — the fields that date changed for itself — so editing the rule updates every future class that has no individual change, while a changed date keeps its own value. |
| `AcademicEvent` | One-off dated academic events (CT/mid-term/final/quiz/deadline) with no recurring rule behind them — a template/instance split is unnecessary when there is no series. |
| `Feedback` | Public feedback form submissions. |
| `Settings` | Singleton document holding every system-wide feature toggle. |

---

## 7. API Reference

Base path: `/api`. Every response is `{ success, data|message, pagination? }`.
Protected routes require `Authorization: Bearer <token>`; role/permission
gates are noted per group. See `server/src/routes/*.js` for exact paths,
params, and validation per endpoint — the groups below are a map, not an
exhaustive spec.

| Prefix | Covers |
|---|---|
| `/auth` | Register (with optional Student ID photo + OTP verification), login, `me`, password change/reset, public feature-flag read |
| `/users`, `/profile`, `/bookmarks` | Favorites, self-service profile edit |
| `/departments`, `/courses`, `/batches`, `/semesters`, `/categories`, `/chapters`, `/topics` | Academic taxonomy CRUD (admin-tier writes, public reads) |
| `/files` | Upload (direct or Uploadcare-attached), search/list/filter, versioning, student self-submission, stats |
| `/search` | Cross-file typo-tolerant search (see [§9](#9-typo-tolerant-search-engine)) |
| `/analytics` | Admin dashboard aggregates |
| `/reviews` | Approve/reject pending student-submitted materials |
| `/faculty` | Faculty-scoped course/material listings |
| `/feedback` | Public feedback submission + Super Admin review |
| `/notices` | Notice CRUD + audience feed |
| `/assignments` | Assignment CRUD, submission, grading |
| `/questions` | Question Bank CRUD + fuzzy `search`/`suggestions` |
| `/quizzes` | Quiz CRUD, attempt lifecycle (start/autosave/submit), manual grading, analytics |
| `/public-exams` | Guest-facing shareable exam landing/attempt/result flow |
| `/messages` | Contacts, conversations, send/read |
| `/emails` | Broadcast send + delivery logs |
| `/roles` | Custom admin-tier role + permission management |
| `/course-enrollments` | Request/approve/reject/manage additional-course enrollment |
| `/notifications` | Self-service list/read/preferences/push-subscribe |
| `/admin/notifications` | Super Admin stats/logs/ad-hoc send |
| `/routine` | Recurring rules and their dated occurrences — `PATCH /routine/templates/:id` is the one edit that brings every future class into line, with an `applyFrom` scope. The audience is derived from the caller (`audienceFilterFor`): their own department/batch/semester/group, **plus** every course they hold an access-granting additional enrollment for, whose classes show even when scheduled under another cohort |
| `/calendar`, `/exams`, `/events` | One-off academic events and exams; `/events/my/current-next` is the schedule widget's single call |
| `/internal/reminders` | The cron target that fires due class/exam reminders (secret-header auth, deliberately not JWT) |
| `/admin`, `/super-admin` | Admin/Super Admin management surfaces (users, faculty, files, settings, etc.) |

---

## 8. Smart Notification System (in-app + PWA push)

Whenever content relevant to a user is created/updated/graded, the right
people are notified automatically — never a blind broadcast, and never
dependent on push actually delivering.

**Architecture** (`server/src/services/notifications/`):
```
Controller (file/assignment/quiz/notice/message/enrollment)
      │  one line, non-blocking: emit({...}).catch(...)
      ▼
notificationService.emit()
      │
      ├─▶ recipientResolver.js   — reuses the app's own course-access/
      │                            targeting rules (never re-invents them):
      │                            department+CourseEnrollment union for
      │                            course-scoped content, OR-across-axes
      │                            for Notices, single-user for messages
      ├─▶ notificationTemplates.js — renders {title, message, url} per type
      ├─▶ Notification.insertMany() — one row per recipient, deduplicated by
      │                                a {recipient,type,entityType,entityId,slot}
      │                                unique index (a retried request never
      │                                double-notifies; `slot` splits the several
      │                                reminders a class produces over time, and a
      │                                moved or edited class gets a fresh row)
      ├─▶ pushService.sendToUser() — Web Push to every active device of each
      │                              recipient with the push channel enabled;
      │                              transient failures are retried, a
      │                              subscription the service says is gone
      │                              (410/404) is retired instead
      ├─▶ fcmService.sendToUserDevices() — the Android transport, same policy
      │                                    (per-token retry; dead tokens retired)
      └─▶ emailService.sendEmail() — a copy by email, only when the global
                                     NOTIFICATION_EMAIL_ENABLED=true (off by
                                     default) AND the recipient's own email
                                     preference is on. Transport comes from
                                     EMAIL_PROVIDER (smtp|resend|console); with
                                     none configured it logs instead of sending
```

**Triggers already wired**: staff file upload/replace → `COURSE_MATERIAL`/
`FILE_UPDATED`; a *student's* material submission → `FILE_UPLOADED` (to the
CR/admin-tier reviewers who work the queue; faculty only when
`NOTIFY_FACULTY_ON_STUDENT_UPLOAD=true`); assignment publish/update →
`ASSIGNMENT_CREATED`/`_UPDATED`; a student handing in an assignment →
`ASSIGNMENT_SUBMITTED` (to faculty — previously silent); grading a submission →
`ASSIGNMENT_RESULT`, and re-grading it → `GRADE_PUBLISHED`; quiz/exam publish →
`EXAM_CREATED`/`_UPDATED`; an auto-graded attempt → `EXAM_RESULT`, a manually
graded one → `RESULT_PUBLISHED`; notice publish → `NOTICE_CREATED`/`_UPDATED`;
sending a message → `MESSAGE_RECEIVED`; enrollment request/approval →
`JOIN_REQUEST`/`JOIN_REQUEST_APPROVED`, staff-initiated (direct/bulk) enrollment →
`COURSE_ENROLLED`; editing a course → `COURSE_UPDATED`.

**Client side**: `NotificationBell`/`Dropdown`/`List`/`Item` components
(polled unread count, react-query-backed), a full `/notifications` page and
`/notifications/settings` (per-type + push/email toggles — `SYSTEM` alerts
are mandatory and can't be disabled; the email toggle only takes effect while the
server's `NOTIFICATION_EMAIL_ENABLED` is on), and `EnableNotificationPrompt` — a
friendly opt-in card shown once, never re-prompted after "Maybe Later" or a
hard browser denial (spec-compliant: never asks on first load).

**Admin tool**: Super Admin → Notifications (`/super-admin/notifications`)
shows delivery stats by type and lets you send an ad-hoc notification to a
specific user, a course, a department, or everyone.

**Setup**: generate a VAPID keypair (`npx web-push generate-vapid-keys`),
set `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`. Without these,
push silently no-ops and everything still works via in-app notifications.
On iOS/iPadOS, Safari only allows Web Push for a PWA added to the Home
Screen — the UI detects this and prompts accordingly.

**Notification-email switches** (separate from the mail transport above, and both
`false` unless explicitly `true`): `NOTIFICATION_EMAIL_ENABLED` turns on the email
copy of event notifications — off by default, and irrelevant to transactional mail
(verify code, reset password, enrollment), which always sends.
`NOTIFY_FACULTY_ON_STUDENT_UPLOAD` adds faculty to the student-submission notice;
by default it goes only to the CR/admin-tier reviewers who work the review queue,
so faculty are not disturbed by routine uploads.

**Class & exam reminders** are a separate delivery path, because they are
time-triggered rather than event-triggered. There is no scheduler in this stack,
so an external cron calls `POST /api/internal/reminders/run` every minute,
authenticated with `REMINDER_CRON_SECRET` in the `x-reminder-secret` header (the
endpoint refuses to run at all while that is unset). Each run is a pure function
of "now", so a repeated tick is a no-op. The offsets' windows partition the
countdown, so a delayed tick still lands in exactly one of them, no offset fires
early, and the message states the class's true remaining time rather than the
offset's. Reminders are deduped on
`{recipient, type, entityType, entityId, slot}`, where `slot` is the offset plus
the class's *effective* start instant — which keeps the 30- and 10-minute
reminders separate, and gives a class that moved a new reminder rather than
leaving the old one active. The schedule itself is the
[§7](#7-api-reference) routine/calendar group.

**Scope decision**: notification fan-out runs in-process (unawaited,
errors caught/logged) rather than through a queue/worker — there's no
Redis/job-queue infra in this app today. `notificationService.emit()` is the
single seam a real queue (BullMQ+Redis) would replace later without
touching any of its ~10 call sites.

---

## 9. Typo-Tolerant Search Engine

`server/src/utils/textSearch.js` powers question-bank search
(`/questions/search`) and question-bank listing filters with real
typo/partial tolerance — pure JS, no external dependency:

- **Damerau-Levenshtein edit distance** (adjacent-transposition-aware, so
  "qeustion" costs 1 edit, not 2).
- **Adaptive thresholds** by token length (≤3 chars: exact/prefix only, 4–6:
  1 edit, 7+: 2 edits) — short queries stay strict so they don't match half
  the dictionary.
- **Weighted multi-field scoring** (question text, tags, topic, subject,
  options, explanation) with exact > prefix > fuzzy ranking, plus a
  whole-phrase substring bonus for multi-word queries ≥4 characters.
- **"Did you mean" correction**, built from real words in the actual
  candidate set — never a static dictionary.
- **Bounded candidates**: scope-filtered (department/course/batch/etc, same
  filters as normal browsing) then capped at `CANDIDATE_CAP` before any
  in-memory scoring — never a full-collection scan. Documented upgrade path
  to MongoDB Atlas Search if a single scope grows past a few thousand
  questions.

Regression-tested against every typo example from its original spec (see
[§13](#13-automated-tests)) — `questi`, `questin`, `queston`, `quesion`,
`qution`, `quetion`, `qustion`, `questio`, `ques`, `quest`, `que`,
`qeustion`, `quiestion`, `qusetion` all match "question", while an unrelated
control word never false-positives.

---

## 10. File Storage Architecture

The rest of the app never talks to a specific storage provider — every
upload/delete goes through **`server/src/services/storage/storageService.js`**:

- `local` (default): saved under `server/uploads/<type>/`, randomized
  filenames (path-traversal safe), served via `/uploads/...`.
- `s3`: any S3-compatible provider (AWS S3, Cloudflare R2, Backblaze B2,
  DigitalOcean Spaces, MinIO) via `S3_*` env vars.
- **Uploadcare**: files go straight from the browser to Uploadcare's CDN —
  the server only stores the resulting metadata (`attachUploadcareFiles`).

Switching providers is a config change, not a code change — every consumer
treats `fileUrl` as an opaque, ready-to-use link.

---

## 11. Progressive Web App (PWA)

Installable and offline-capable via `vite-plugin-pwa`, running in
**`injectManifest`** mode with a custom service worker source
(`client/src/sw.js`) — needed because push notifications require a
`push`/`notificationclick` event listener that the fully-automatic
`generateSW` mode has no hook for.

- **Precaching + runtime caching**: `precacheAndRoute` for the app shell,
  plus `StaleWhileRevalidate` for API GETs and `CacheFirst` for uploaded
  files/CDN images — ported 1:1 from the previous `generateSW` config,
  including the SPA navigation fallback (`NavigationRoute`) for offline
  routing.
- **Push**: `self.addEventListener('push', ...)` parses the JSON payload and
  shows a notification; `notificationclick` focuses an existing app window
  (posting it the target URL to navigate) or opens a new one.
- **Update flow**: `PwaUpdatePrompt.jsx` shows a toast + persistent
  "Update available" button, re-checking whenever the tab regains focus.
- The service worker only builds in production (`npm run build` /
  `vite preview`) — `npm run dev` never registers one.

To verify: `npm run build --prefix client && npm run preview --prefix
client`, open in a real browser (service workers don't run in most sandboxed
preview panes), check DevTools → Application → Service Workers/Manifest, or
run a Lighthouse PWA audit.

---

## 12. In-App User Manual

A role-aware manual lives inside the app itself — no external docs site to
keep in sync:

| Route | Audience |
|---|---|
| `/manual` | Students (linked from the top navbar) |
| `/faculty/manual` | Faculty (linked from the Faculty sidebar) |
| `/admin/manual` | Admin (linked from the Admin sidebar) |
| `/super-admin/manual` | Super Admin (linked from the Super Admin sidebar) |

Content lives in `client/src/data/manualContent.js`, rendered by the shared
`client/src/pages/Manual.jsx` accordion component — updating a workflow's
instructions is a content edit, not a new page.

---

## 13. Automated Tests

```bash
npm --prefix server test
npm --prefix client test   # the Document Generator's resize geometry (pure, no browser)
```

Node's built-in test runner (`node:test`) — no new test-framework
dependency. Server suites:
- **`textSearch.test.js`** — pure unit tests for the fuzzy search engine
  (edit distance, adaptive thresholds, ranking, every typo example from its
  spec, regression coverage for two real bugs caught during development).
- **`notifications/*.test.js`** — integration tests for
  `recipientResolver`/`notificationService` against a disposable local
  MongoDB database (created and dropped per test file, never the dev DB):
  course-scoped access (department, blocked users, cross-department
  enrollment), Notice's OR-across-axes targeting, idempotent `emit()` (a
  retried event never double-notifies, but a genuinely different event
  isn't wrongly deduped), and per-type notification-preference enforcement.

Requires a MongoDB the suite can create and drop throwaway databases on. It
defaults to `127.0.0.1:27017` (the same as the app itself) — no mocking layer,
since correctness of these queries is the whole point. Where there is no local
server (e.g. a deploy box whose database is Atlas), set `TEST_MONGODB_URI` to
the cluster's connection string:

```bash
TEST_MONGODB_URI="mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/?retryWrites=true" \
  npm --prefix server test
```

Each file creates its own `notif_test_<label>_<random>` database and drops it
afterwards. Any database named in `TEST_MONGODB_URI` is replaced by that
throwaway name, so the suite can never touch the application's own data — even
if the URI points straight at it. (When using Atlas, allow the running machine's
IP in **Network Access**.)

---

## 14. Security Notes

- Helmet, CORS (locked to `CLIENT_URL`, supports a comma-separated list),
  rate limiting on `/api`, `express-mongo-sanitize` against NoSQL injection,
  `express-validator` on write endpoints.
- Every protected request re-fetches the user from the database (role/status
  never trusted from the JWT alone); a `tokenVersion` bump invalidates old
  tokens instantly on password change, block, or role change.
- Admin-tier access is permission-gated per module (`requirePermission`),
  not a single all-or-nothing admin flag — a custom role only ever sees what
  it's explicitly been granted.
- Notification/messaging/enrollment endpoints always resolve recipients from
  server-side course/department/enrollment data — never from client-supplied
  recipient lists (except the explicitly-gated Super Admin broadcast tool).
  A user can never read another user's notifications, subscribe another
  user's device, or see another student's exam/assignment result.
- Roll No/Student ID is enforced **globally unique** at both the database
  index level and as an explicit, friendly pre-check on every write path
  (registration, self-service profile edit, Super Admin user edit).
- Uploads: MIME-type allowlist, size-limited, randomized on-disk filenames.
  Deleting a file removes both the MongoDB record and the stored asset.
- Public Exam guest attempts never expose another participant's identity or
  answers; exam attempts always resolve questions/marks from their own
  snapshot, never from the live quiz/question-bank state, so a later edit
  can never retroactively change a finished attempt.

## 15. Known Limitations / Next Steps

- No message queue/worker exists yet — notification fan-out is in-process,
  documented as the upgrade seam for a future BullMQ+Redis setup if a single
  event's recipient count grows very large.
- Real Web Push delivery to a physical iOS/Android device (and iOS's
  "must be added to Home Screen first" gate) needs a real device to verify
  end-to-end — implemented per platform docs, exercised in this dev
  environment only via subscription storage + send-call correctness.
- No true semantic/embedding search — the fuzzy search engine (edit
  distance + weighted token scoring) covers typos/partial queries; natural-
  language "meaning" search would need an embeddings pipeline this
  self-hosted deployment doesn't have.
- The S3-compatible storage provider works but has no built-in migration
  tool from `local` — write a one-off script if you switch providers with
  existing local files.

---

## 16. Deployment

### 16.1 Architecture at a glance

```text
Frontend (static build)              →  Vercel / Netlify / Cloudflare Pages
Backend (long-running Node process)  →  Render / Railway / Fly.io / a VPS
Database                             →  MongoDB Atlas
Documents/Images                     →  local disk on the backend host, S3-compatible storage, or Uploadcare
```

**Important:** the backend must run as a persistent, long-running process,
not a serverless function — `FILE_STORAGE_PROVIDER=local` writes to
`server/uploads/` on that instance's disk, which a serverless platform
doesn't durably provide. Either attach a persistent volume there, or use
S3-compatible/Uploadcare storage instead.

### 16.2 Database — MongoDB Atlas

- Network Access must allow your backend host's IP (or `0.0.0.0/0` on
  dynamic-IP PaaS — still safe since auth is required).
- `server/src/config/db.js` already points Node's DNS resolver at
  `1.1.1.1`/`8.8.8.8` before connecting when the URI is `mongodb+srv://`,
  working around ISPs/networks that don't forward SRV DNS queries.

### 16.3 Backend — example with Render (Railway/Fly.io are similar)

1. Push this repo to GitHub.
2. Render → **New → Web Service**, root directory `server`, build command
   `npm install`, start command `npm start`.
3. Attach a persistent Disk mounted at your `UPLOAD_DIR` path if using local
   document storage.
4. Set every variable from [§5](#5-environment-variables) in Render's
   Environment tab — **generate a fresh `JWT_SECRET`** and a fresh VAPID
   keypair for production, never reuse dev values.
5. Deploy, then run the seed script once against production:
   ```bash
   MONGODB_URI="<atlas-uri>" SEED_SUPER_ADMIN_EMAIL="you@yourdomain.com" SEED_SUPER_ADMIN_PASSWORD="<strong-password>" npm --prefix server run seed
   ```
   Log in and change that password immediately.

### 16.4 Frontend — example with Vercel (Netlify is nearly identical)

1. Vercel → **New Project**, root directory `client`, framework preset Vite.
2. Set `VITE_API_URL` (your deployed backend + `/api`), `VITE_GA_MEASUREMENT_ID`,
   `VITE_UPLOADCARE_PUBLIC_KEY` as needed.
3. Deploy, then set the backend's `CLIENT_URL` to this exact URL and
   redeploy the backend — CORS in production is locked to that origin.

### 16.5 Post-deploy checklist

- [ ] `NODE_ENV=production` on the backend.
- [ ] Fresh `JWT_SECRET` and VAPID keypair — not dev placeholders.
- [ ] `CLIENT_URL` matches the frontend's exact production URL (https, no trailing slash).
- [ ] `VITE_API_URL` matches the backend's exact production URL + `/api`.
- [ ] MongoDB Atlas network access allows the backend host.
- [ ] Seed script run once against production; both seeded passwords changed after first login.
- [ ] Document storage is durable (persistent disk, or S3-compatible/Uploadcare).
- [ ] Email provider configured (`EMAIL_PROVIDER=smtp` or `resend`) — otherwise OTP/reset/broadcast emails just log to console.
- [ ] `FIREBASE_SERVICE_ACCOUNT` set — otherwise Android push notifications are silently skipped (in-app notifications are unaffected). See [`docs/FCM_PUSH_SETUP.md`](docs/FCM_PUSH_SETUP.md).
- [ ] `REMINDER_CRON_SECRET` set, and an external cron hitting `POST /api/internal/reminders/run` (header `x-reminder-secret`) every minute — otherwise no class or exam reminder is ever sent. The endpoint refuses to run (503) while the secret is unset.
- [ ] `.env` files are not committed (already covered by `.gitignore`).
- [ ] HTTPS is active on both frontend and backend.

### 16.6 Android push notifications (FCM)

Optional, and independent of the rest of the deployment. The backend skips FCM
entirely until it is configured, and the Android app works without it. Full
setup and test procedure: [`docs/FCM_PUSH_SETUP.md`](docs/FCM_PUSH_SETUP.md).

- [ ] `ISUAcademicPortal/app/google-services.json` added (Firebase Console → Add app → Android, package `com.bluespacetech.isuacademicportal`).
- [ ] `FIREBASE_SERVICE_ACCOUNT` (or `FIREBASE_SERVICE_ACCOUNT_PATH`) set on the backend.
- [ ] App rebuilt and installed after adding `google-services.json`.

### 16.7 Document Generator

Students generate cover pages and other academic PDFs from admin-authored
templates. It needs **Redis** (BullMQ) and **Chromium** on the server, in addition
to everything above. Full reference: [`docs/DOCUMENT_GENERATOR.md`](docs/DOCUMENT_GENERATOR.md).

- [ ] `REDIS_URL` set (Railway/Render Redis add-on, Upstash, or local Docker).
- [ ] `npx playwright install --with-deps chromium` in the server build step.
- [ ] Worker: `PDF_WORKER_IN_PROCESS=true` (one service) or a second service running `npm --prefix server run worker` with `PDF_WORKER_IN_PROCESS=false`.
- [ ] S3 lifecycle rule expiring `generated-documents/` after 1 day.
- [ ] `npm --prefix server run seed` once — creates the categories and the first template (optionally attach the reference design via `DOCUMENT_SEED_SOURCE_PATH`).
- [ ] `documents` permission granted to any custom admin-tier role that manages templates (Super Admin always can).

## 17. Document Generator

Cover-page/document generation, integrated into the existing portal — no separate
app, and no parallel auth, storage or notification system.

- **Templates are data.** Admins upload a reference cover (PDF/PNG/JPG), map its
  fields to portal data or to student input, position them on an A4 canvas and
  publish. New categories, department- and course-specific templates and new
  versions need no code change.
- **A real visual editor.** A Word-like authoring surface: drag elements in from a
  palette (text, dynamic field, image/logo, rule), move and **resize** them with
  eight grips (Ctrl for 0.1 mm steps, Shift to keep the shape), snap to the page
  and to other elements, align, reorder (bring to front / send to back), lock,
  zoom, and undo/redo everything (Ctrl+Z). Formatting covers **font family**,
  size, bold / italic / underline / strikethrough, line and character spacing,
  colour, highlight, and borders &amp; shading (width, style, colour, corner
  radius) on any element. Images come from the server's `img/` folder — the
  university logo is drag-and-droppable straight onto a design.
- **Nothing official is editable.** Student name, Student ID, batch, group,
  department, course code/name and teacher are resolved **server-side** from the
  authenticated user's own records; the client can never submit them.
- **The teacher is chosen, not guessed.** Because a course often has more than
  one, the student picks from that course's own faculty (validated server-side —
  a name cannot be invented); with a single teacher it is pre-selected.
- **Preview is HTML, not a PDF.** The same renderer produces both, so what is
  reviewed cannot diverge from what is generated.
- **Generation is asynchronous.** `POST /api/documents/generate` creates the job
  and returns its id immediately; a BullMQ worker renders it with headless
  Chromium, stores the PDF privately in S3 and notifies the user through the
  existing notification/FCM system.
- **Downloads are short-lived signed URLs**, minted per request after an ownership
  check. Generated files expire after 24 hours (S3 lifecycle + `expiresAt`).

Full reference — data model, endpoints, environment variables, worker/Redis, S3,
security and testing: [`docs/DOCUMENT_GENERATOR.md`](docs/DOCUMENT_GENERATOR.md).
