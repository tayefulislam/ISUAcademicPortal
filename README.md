# Academic File Management & Search System

A centralized platform for students to search and view academic files (PDFs,
images, notes, assignments, question papers) by department, course, batch,
semester, and keyword — with an admin panel for uploads and management.

**Stack:** React (Vite) + Tailwind · Node.js/Express · MongoDB/Mongoose · JWT
auth · pluggable file storage (local disk / ImgBB / future S3) · Google
Analytics 4.

---

## 1. Project Structure

```text
academic-file-system/
├── client/                  React frontend (Vite)
│   └── src/
│       ├── api/              axios instance + typed endpoint calls
│       ├── components/       FileCard, PdfViewer, ImageViewer, SearchFilters, ...
│       ├── context/          AuthContext, ToastContext
│       ├── hooks/            useDebouncedValue, useDownloadFile
│       ├── layouts/          MainLayout, AdminLayout
│       ├── pages/            Home, SearchResults, FileDetails, admin/*
│       └── utils/            format.js, analytics.js
├── server/                  Express backend
│   └── src/
│       ├── config/            env.js, db.js
│       ├── controllers/       one per resource (auth, files, search, ...)
│       ├── middleware/        auth, upload (multer), validate, errorHandler
│       ├── models/            User, Department, Course, Batch, Category, File
│       ├── routes/            REST route definitions
│       ├── services/
│       │   ├── storage/         storageService.js (the ONLY module the app
│       │   │                    talks to), localStorage.js, imgbbStorage.js,
│       │   │                    s3Storage.js (future)
│       │   └── fileQueryBuilder.js   shared search/filter query logic
│       ├── utils/              seed.js, jwt.js, ApiError.js, fileTypes.js
│       └── app.js
├── .env.example
└── package.json              root scripts (dev, install:all, seed)
```

## 2. Getting Started

### Prerequisites
- Node.js 18+
- MongoDB running locally (`mongodb://127.0.0.1:27017`) or an Atlas URI

### Install & configure

```bash
git clone <repo-url> academic-file-system
cd academic-file-system
cp .env.example .env
npm run install:all
```

Edit `.env` (or `server/.env` if you split it) and set at minimum:
- `MONGODB_URI`
- `JWT_SECRET`
- `IMGBB_API_KEY` (get a free key at https://api.imgbb.com/) — required for
  image uploads only; document uploads (PDF etc.) work without it.

### Seed sample data (departments, courses, batches, categories, admin user)

```bash
npm run seed
```

This creates an admin account: `admin@university.edu` / `Admin@12345`
(override with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` env vars).

### Run in development

```bash
npm run dev
```

This runs the API on `http://localhost:5000` and the frontend on
`http://localhost:5173` concurrently. Or run them separately:

```bash
npm run dev:server   # http://localhost:5000
npm run dev:client   # http://localhost:5173
```

### Build for production

```bash
npm run build:client   # outputs client/dist
npm run start:server   # node server/src/app.js
```

Serve `client/dist` with any static host/CDN (or behind the same reverse
proxy as the API) and point `VITE_API_URL` at the deployed API's `/api` URL.

---

## 3. Environment Variables

| Variable | Description |
|---|---|
| `NODE_ENV` | `development` \| `production` |
| `PORT` | API port (default `5000`) |
| `CLIENT_URL` | Frontend origin, used for CORS |
| `MONGODB_URI` | MongoDB connection string |
| `JWT_SECRET` | Secret used to sign JWTs — must be long/random in production |
| `JWT_EXPIRES_IN` | Token lifetime, e.g. `7d` |
| `FILE_STORAGE_PROVIDER` | `local` \| `s3` — storage for documents (PDF/DOC/PPT/XLS/TXT/ZIP) |
| `UPLOAD_DIR` | Local upload root (only used when provider is `local`) |
| `MAX_FILE_SIZE_MB` | Per-file upload limit |
| `IMGBB_API_KEY` | Required for image uploads (JPG/PNG/WEBP/GIF always go to ImgBB) |
| `S3_*` | Reserved for the future S3-compatible provider |
| `VITE_API_URL` | Frontend → backend base URL, e.g. `http://localhost:5000/api` |
| `VITE_GA_MEASUREMENT_ID` | Google Analytics 4 measurement ID (`G-XXXXXXXXXX`) |

---

## 4. File Storage Architecture

The rest of the app never talks to a specific storage provider — every
upload/delete goes through **`server/src/services/storage/storageService.js`**:

- **Images** (jpg/jpeg/png/webp/gif) → always uploaded to **ImgBB**.
  MongoDB stores the returned URL (`fileUrl`) and delete token
  (`storageRef`), never the binary.
- **Documents** (pdf/doc/docx/ppt/pptx/xls/xlsx/txt/zip) → stored via the
  provider named in `FILE_STORAGE_PROVIDER`:
  - `local` (default): saved under `server/uploads/<type>/`, filenames are
    randomized (`<timestamp>_<random>_<slug>.<ext>`) to prevent path
    traversal and collisions; served back via `/uploads/...` static route.
  - `s3` (future): implement `uploadDocumentS3`/`deleteDocumentS3` in
    `s3Storage.js` with the same signature as `localStorage.js` — no
    controller or frontend code changes needed to switch providers.

To migrate existing local files to S3/R2 later: write a one-off script that
reads each `File` document with `storageProvider: 'local'`, uploads the
bytes via the new provider, and updates `fileUrl` / `storageProvider` /
`storageRef` — the frontend already treats `fileUrl` as an opaque, ready-to-use
link regardless of where it points.

---

## 5. Database Models (MongoDB / Mongoose)

- **User** — name, email, password (bcrypt-hashed), role (`student`|`admin`),
  department, batch, favorites.
- **Department** — name, code, description, status.
- **Course** — name, courseId, department (ref), credit, semester, status.
- **Batch** — name, code, department (ref, optional), year, status.
- **Category** — name, slug, description, status.
- **File** — title, originalName, fileName, fileType, mimeType, fileSize,
  fileUrl, storageProvider, storageRef, department/course/batches (refs +
  denormalized code/name fields for fast search without `$lookup`),
  semester, academicYear, category, description, keywords[], uploadedBy,
  views, downloads.

`File` has a weighted **text index** (title, courseName, courseId,
departmentCode, categoryName, keywords) plus single-field indexes on
department/course/batches/category/fileType/createdAt/views/downloads for
fast filtered search and sorting at scale.

---

## 6. REST API Reference

Base URL: `http://localhost:5000/api`. All responses are
`{ success, data|message, pagination? }`. Auth endpoints and mutating
routes below marked 🔒 require `Authorization: Bearer <token>`; 🔒admin
requires an admin-role account.

### Auth — `/auth`
| Method | Path | Description |
|---|---|---|
| POST | `/auth/register` | Create a student account. Body: `name, email, password` |
| POST | `/auth/login` | Returns `{ user, token }`. Body: `email, password` |
| GET🔒 | `/auth/me` | Current authenticated user |

### Users — `/users`
| Method | Path | Description |
|---|---|---|
| GET🔒admin | `/users` | List users (`?role=&page=&limit=`) |
| PUT🔒admin | `/users/:id/role` | Change role. Body: `{ role }` |
| PUT🔒admin | `/users/:id/active` | Activate/deactivate. Body: `{ isActive }` |
| GET🔒 | `/users/me/favorites` | Current user's bookmarked files |
| POST🔒 | `/users/me/favorites/:fileId` | Toggle a favorite |

### Departments — `/departments`
| Method | Path | Description |
|---|---|---|
| GET | `/departments` | List active departments |
| GET | `/departments/:id` | Get one |
| GET | `/departments/:id/courses` | Courses in this department |
| POST🔒admin | `/departments` | Create. Body: `name, code, description?` |
| PUT🔒admin | `/departments/:id` | Update |
| DELETE🔒admin | `/departments/:id` | Delete (blocked if it still has files) |

### Courses — `/courses`
| Method | Path | Description |
|---|---|---|
| GET | `/courses?department=&page=&limit=` | List (paginated) |
| GET | `/courses/:id` | Get one |
| POST🔒admin | `/courses` | Create. Body: `name, courseId, department, credit?, semester?, description?` |
| PUT🔒admin | `/courses/:id` | Update |
| DELETE🔒admin | `/courses/:id` | Delete (blocked if it still has files) |

### Batches — `/batches`
| Method | Path | Description |
|---|---|---|
| GET | `/batches?department=` | List |
| GET | `/batches/:id` | Get one |
| POST🔒admin | `/batches` | Create. Body: `name, code, department?, year?` |
| PUT🔒admin | `/batches/:id` | Update |
| DELETE🔒admin | `/batches/:id` | Delete (blocked if it still has files) |

### Categories — `/categories`
| Method | Path | Description |
|---|---|---|
| GET | `/categories` | List |
| POST🔒admin | `/categories` | Create. Body: `{ name, description? }` |
| PUT🔒admin | `/categories/:id` | Update |
| DELETE🔒admin | `/categories/:id` | Delete (blocked if it still has files) |

### Files — `/files`
| Method | Path | Description |
|---|---|---|
| GET | `/files` | List with filters (see Search below), paginated |
| GET | `/files/stats` | `{ departments, courses, batches, files }` counts |
| GET | `/files/recent?limit=` | Most recently uploaded |
| GET | `/files/popular?limit=` | Sorted by views + downloads |
| GET | `/files/:id` | Get one (increments `views`) |
| GET | `/files/:id/related` | Other files from the same course |
| POST | `/files/:id/download` | Increments `downloads`, returns `{ fileUrl, originalName }` |
| POST🔒admin | `/files` | Upload (multipart/form-data — see below) |
| PUT🔒admin | `/files/:id` | Update metadata (title, description, semester, academicYear, keywords, status) |
| DELETE🔒admin | `/files/:id` | Delete file + its stored binary |
| POST🔒admin | `/files/bulk-delete` | Body: `{ ids: [...] }` |

**Upload body** (`multipart/form-data`):
`file` (binary), `title`, `description?`, `departmentId`, `courseIdRef`,
`categoryId`, `semester?`, `academicYear?`, `keywords?` (comma-separated),
`batches?` (repeat the field per batch id), `allBatches?` (`true`/`false`).

### Search — `/search`
| Method | Path | Description |
|---|---|---|
| GET | `/search` | Full-text + filtered search (see below) |
| GET | `/search/suggestions?q=` | Lightweight course name/ID typeahead |

Shared query params for `/files` and `/search`:
`q` (full-text, matches title/originalName/course/courseId/department/category/keywords),
`department`, `course`, `courseId`, `batch`, `semester`, `academicYear`,
`fileType`, `category`, `dateFrom`, `dateTo`, `page`, `limit`, `sort`
(`newest`|`oldest`|`popular`|`downloads`|`name`).

Example:
```
GET /api/search?q=discrete&department=<id>&batch=BATCH-14&fileType=pdf&page=1&limit=12
```

### Analytics — `/analytics`
| Method | Path | Description |
|---|---|---|
| GET🔒admin | `/analytics/dashboard` | Totals, most viewed/downloaded, recent uploads, popular courses/departments |

Raw traffic analytics (device type, traffic source, page views) are tracked
client-side via **Google Analytics 4** (see `client/src/utils/analytics.js`),
not stored in MongoDB — this dashboard reflects the view/download counters
already on each `File` document.

---

## 7. Google Analytics 4

Set `VITE_GA_MEASUREMENT_ID` in `client/.env`. The app tracks:
`page_view`, `search`, `filter_used`, `file_view`, `file_download` — see
`client/src/utils/analytics.js` (`trackEvent`) and its call sites in
`SearchResults.jsx`, `FileDetails.jsx`, and `useDownloadFile.js`. No personal
data (names/emails) is ever sent in event params.

---

## 8. Security Notes

- Helmet, CORS (locked to `CLIENT_URL`), rate limiting (300 req/15min/IP on
  `/api`), `express-mongo-sanitize` against NoSQL injection, and
  `express-validator` on write endpoints.
- Passwords hashed with bcrypt; JWTs signed with `JWT_SECRET` and verified
  on every protected route; role checks via `requireRole('admin')`.
- Uploads: MIME-type allowlist (not just extension), size-limited
  (`MAX_FILE_SIZE_MB`), memory-buffered then written with a randomized
  filename (path-traversal safe) — the original filename is never used as
  the on-disk name.
- Deleting a file removes both the MongoDB record and the physical/ImgBB
  asset — no orphaned files.

## 9. Known Limitations / Next Steps

- The S3/R2 storage provider is stubbed (`s3Storage.js`) but not
  implemented — wire it up when you're ready to migrate off local disk.
- Admin user creation is via the seed script only; there's no in-app "invite
  admin" flow yet (promote a student via `PUT /users/:id/role`).
- No automated test suite yet; verified manually end-to-end (auth, upload,
  search, PDF viewer, admin dashboard) during development.
"# ISUAcademicPortal" 
