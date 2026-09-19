# Write Application — AI letters with a credit system

Students, faculty and staff draft formal university applications with AI, edit
them, and export a PDF or DOCX. The backend is the single source of truth: the
web client and the Android app call the same endpoints and neither computes a
credit balance, an identity, or a recipient of its own.

## Environment

Only the API key is a secret and stays in the environment. Everything an admin
may change at runtime has a database-backed override in **System Management →
Settings** (`aiProvider`, `aiModel`, `aiMonthlyCredits`, `aiGenerationCost`,
`aiExportExpirationHours`, `applicationWriterEnabled`, `aiCreditsEnabled`).

```env
AI_ENABLED=true
AI_PROVIDER=deepseek              # deepseek | openai | openrouter | gemini
AI_MODEL=deepseek-chat
AI_API_KEY=                       # REQUIRED to generate
AI_BASE_URL=                      # optional; for a compatible gateway
AI_TIMEOUT_MS=45000
AI_MAX_TOKENS=2000
AI_TEMPERATURE=0.4

AI_CREDIT_ENABLED=true
AI_MONTHLY_CREDITS=10
AI_APPLICATION_GENERATION_COST=1
AI_APPLICATION_EDIT_COST=1
AI_CREDIT_ROLLOVER=false
AI_CREDIT_RESET_DAY=1
AI_EXPORT_EXPIRATION_HOURS=24

AI_GENERATE_RATE_LIMIT=12         # per 15 min per user
```

DeepSeek, OpenAI and OpenRouter share one OpenAI-compatible request shape;
Gemini uses its own. The provider and model are read from Settings on every call,
so switching providers needs no redeploy — only `AI_API_KEY` does.

## One-off setup

```bash
npm --prefix server run seed:applications   # 17 application types + 6 recipients
```

Insert-only and idempotent — an admin's edits are never overwritten. Then, in the
admin UI:

1. **Application Recipients** — fill in each recipient's office/address, and set
   each department's **head** so "Head of Department" resolves to the real person.
2. **Application Types** — adjust the extra questions, default AI instructions
   and document wording (salutation/closing) per type.

## Endpoints

User (authenticated):

```
GET  /application-types                 GET  /application-recipients
GET  /application-recipients/resolve    GET  /applications/profile-preview
GET  /applications/ai-status
POST /applications/generate             POST /applications/ai/edit
POST /applications/suggestions
POST /applications                      GET  /applications[/:id]
PUT  /applications/:id                  DELETE /applications/:id
POST /applications/:id/duplicate        POST /applications/:id/archive
POST /applications/:id/versions         GET  /applications/:id/versions
POST /applications/:id/generate-pdf     POST /applications/:id/generate-docx
GET  /applications/:id/exports
GET  /application-exports/:exportId/download
GET  /application-exports/:exportId/content
GET  /ai-credits                        GET  /ai-credits/history
```

Admin (`requirePermission('applications')`; super-admin tier bypasses):

```
GET|POST /admin/application-types        PUT|DELETE /admin/application-types/:id
GET|POST /admin/application-recipients   PUT|DELETE /admin/application-recipients/:id
GET      /admin/application-departments  PUT /admin/application-departments/:id/head
GET      /admin/ai-credits               GET /admin/ai-credits/:userId/history
POST     /admin/ai-credits/:userId/adjust
```

## Credits

Reserve → call AI → finalize or release. The reservation is an atomic
`findOneAndUpdate({ user, balance: { $gte: cost } }, { $inc: … })`, so two
simultaneous requests can never spend the same last credit. A failed AI call
releases the reservation and writes a REFUND row; every balance change is a
`CreditTransaction`.

- **Costs**: generation (`aiGenerationCost`, 1) and each AI edit action (`AI_APPLICATION_EDIT_COST`, 1).
- **Free**: opening, editing, saving a draft, viewing, PDF, DOCX, re-downloading, and a failed AI call.

Monthly recharge runs as a **daily** BullMQ job on the existing `document-generation`
queue (`ensureApplicationSchedules()` at boot). Each account is recharged by a
compare-and-set on `nextRechargeAt`, so a doubled run pays exactly once. An
account is also recharged lazily when it is first touched after its period ends.

## Exports

A PDF (Playwright, the shared browser) or a DOCX (`docx`) is rendered from the
saved application, stored **privately** at
`application-exports/{applicationId}/{exportId}.pdf|docx`, and recorded with
`expiresAt = now + AI_EXPORT_EXPIRATION_HOURS` (24). The download endpoint
authorizes the owner, checks the expiry, and mints a fresh short-lived link.

An **hourly** BullMQ job deletes expired objects and marks the row `EXPIRED`. A
delete that fails leaves the row `ACTIVE` and retries next run; a missing object
still marks the row expired. **The application is never deleted** by export
expiry — only the temporary file.

## Safety properties

- The applicant's identity is read from the authenticated user's own record; a
  body-supplied name/ID is ignored, and only editable fields are ever stored.
- The recipient block is an admin record (with the department's head for a HOD) —
  the AI is never asked who to address.
- The prompt states the never-invent rules explicitly, and the letter's date,
  letterhead, salutation and signature block are rendered server-side.
- Every interpolated value in the PDF is HTML-escaped; no prompt or key ever
  reaches a client.

## Verification checklist

- 10 / 1 / 0 credits; successful generation; failed generation refunds.
- Double-click and concurrent generation: the last credit is spent once.
- Monthly recharge twice: paid once.
- PDF + DOCX produced, stored privately, downloadable; expired download → 410.
- Export expiry sweep twice: idempotent.
- Admin adjustment writes an `ADMIN_ADJUSTMENT` transaction.
