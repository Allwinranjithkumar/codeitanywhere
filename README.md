# ⚡ CodeItAnywhere

> A professional online coding assessment platform with multi-language code execution, anti-cheat monitoring, real-time leaderboard, and full admin management — built with Node.js, Express, and PostgreSQL.

---

## 🚀 Features

| Feature | Details |
|---|---|
| **Multi-language Judge** | Python, JavaScript (Node.js), C, C++, Java |
| **Contest Management** | Create, schedule, and manage contests with server-authoritative timing |
| **Anti-Cheat System** | Tab switch, copy/paste, devtools, right-click detection — all logged to DB |
| **Real-time Leaderboard** | Persistent in PostgreSQL, ranks by score → problems solved → first submission |
| **Admin Dashboard** | Stats, student management, problem CRUD, Excel import/export |
| **Full Submission History** | Every submission stored — never overwritten |
| **Secure Authentication** | bcrypt + JWT, rate-limited, no password pre-fill |
| **Role-Based Access** | Student vs Admin — role always from DB, never from client |

---

## 🏗️ Architecture

```
Browser (HTML/JS/CSS)
        │
        ▼
Express API (Node.js)
   ├── /api/auth/*         — Register, Login
   ├── /api/contests/*     — Contest lifecycle, problems, leaderboard
   ├── /api/judge/*        — Run code, submit, violations
   └── /api/admin/*        — Admin-only management
        │
        ▼
PostgreSQL (single source of truth)
        │
        ▼ (for code execution)
child_process (Python / Node / GCC / G++ / Java)
```

---

## 🗄️ Database Schema

```
users              — students and admins
contests           — contest metadata + timing
problems           — problem bank
test_cases         — per-problem test cases (hidden from students)
starter_code       — per-language starter templates
contest_problems   — which problems belong to which contest
contest_participants — who joined which contest
submissions        — full history (status, score, source_code, timing)
violations         — anti-cheat events with metadata
```

---

## ⚙️ Setup

### Prerequisites

- Node.js ≥ 18
- PostgreSQL ≥ 14
- Python 3, GCC/G++, Java (for judge support)

### 1. Clone

```bash
git clone https://github.com/yourname/codeitanywhere.git
cd codeitanywhere
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Database
DB_USER=postgres
DB_HOST=localhost
DB_NAME=coding_platform
DB_PASSWORD=your_strong_password
DB_PORT=5432

# JWT — generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_SECRET=your_64_char_hex_secret_here

# Admin account (created on first startup)
ADMIN_EMAIL=admin@yourplatform.com
ADMIN_PASSWORD=your_strong_admin_password
ADMIN_NAME=System Administrator
```

### 3. Create PostgreSQL Database

```bash
psql -U postgres -c "CREATE DATABASE coding_platform;"
```

### 4. Reset & Initialize Schema (first time)

```bash
npm run db:reset
```

### 5. Start

```bash
npm start
# Development (auto-reload):
npm run dev
```

The server starts at **http://localhost:3000**

---

## 🛡️ Security

| Measure | Implementation |
|---|---|
| Password hashing | bcrypt, cost factor 12 |
| JWT signing | HS256, required env secret |
| Rate limiting | 20 auth requests / 15 min per IP |
| Role verification | Always from DB, never from client |
| DB-down behaviour | Returns 503 — no bypass |
| Code isolation | Unique temp dir per execution, cleaned up in finally |
| Hidden test cases | Never sent to student-facing API |
| Violation types | Validated against server-side whitelist |
| Stack traces | Never exposed in production responses |
| Credentials in git | `.env` in `.gitignore`, `.env.example` included |

---

## 📡 API Reference

### Auth

| Method | Path | Description |
|---|---|---|
| POST | `/api/register` | Register new student |
| POST | `/api/login` | Login, returns JWT |

### Contests

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/contests` | Student | List all contests |
| GET | `/api/contests/active` | Student | Get active contest |
| GET | `/api/contests/:id` | Student | Contest details + server time |
| GET | `/api/contests/:id/status` | Student | Server-authoritative status |
| GET | `/api/contests/:id/problems` | Student | Problems (sample cases only) |
| POST | `/api/contests/:id/join` | Student | Join contest |
| GET | `/api/contests/:id/leaderboard` | Student | Contest leaderboard |
| POST | `/api/contests` | Admin | Create contest |
| PUT | `/api/contests/:id` | Admin | Update contest / status |
| POST | `/api/contests/:id/problems` | Admin | Assign problem to contest |

### Judge

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/judge/problems` | Student | All active problems |
| POST | `/api/judge/run` | Student | Run against sample cases |
| POST | `/api/judge/submit` | Student | Submit (persisted) |
| GET | `/api/judge/submissions/:problemId` | Student | Own submission history |
| GET | `/api/judge/leaderboard` | Student | Global leaderboard |
| POST | `/api/judge/log-violation` | Student | Log anti-cheat event |

### Admin

| Method | Path | Description |
|---|---|---|
| GET | `/api/admin/stats` | Dashboard summary |
| GET | `/api/admin/users` | All students |
| GET | `/api/admin/submissions` | Submissions (filterable) |
| GET | `/api/admin/violations` | All violations |
| GET | `/api/admin/export` | Excel export |
| POST | `/api/admin/sync-excel` | Import students from Excel |
| GET | `/api/admin/problems` | All problems (full data) |
| POST | `/api/admin/problems` | Create problem |
| PUT | `/api/admin/problems/:id` | Update problem |
| DELETE | `/api/admin/problems/:id` | Soft-delete problem |
| POST | `/api/admin/problems/:id/testcases` | Add test case |
| POST | `/api/admin/problems/import-json` | Bulk import from JSON |
| DELETE | `/api/admin/reset` | Wipe all submission data |

---

## 👨‍💻 Tech Stack

- **Backend:** Node.js 18+, Express 4
- **Database:** PostgreSQL 14+
- **Auth:** JWT (jsonwebtoken) + bcrypt
- **Judge:** child_process (Python3, Node, GCC, G++, Java)
- **Frontend:** Vanilla HTML/CSS/JS + CodeMirror 5
- **Export:** xlsx
- **Security:** express-rate-limit, uuid
- **Runtime:** dotenv

---

## 📁 Project Structure

```
├── public/
│   ├── index.html        # Login/Register
│   ├── auth.js           # Auth frontend logic
│   ├── contest.html      # Contest IDE
│   ├── app.js            # Contest frontend logic
│   └── admin.html        # Admin dashboard
├── server/
│   ├── server.js         # Entry point
│   ├── db.js             # Pool + schema init
│   ├── routes/
│   │   ├── auth.routes.js
│   │   ├── contest.routes.js
│   │   ├── judge.routes.js
│   │   └── admin.routes.js
│   ├── middleware/
│   │   └── auth.middleware.js
│   ├── services/
│   │   ├── judgeService.js
│   │   ├── problemService.js
│   │   ├── contestService.js
│   │   └── seedAdmin.js
│   └── scripts/
│       └── resetDB.js    # One-time DB reset
├── problems/
│   └── problems.json     # Legacy; auto-migrated to DB on startup
├── data/
│   └── allowed_users.xlsx # For Excel import (admin-triggered)
├── .env.example
├── .gitignore
└── package.json
```

---

## 🔧 Development Scripts

```bash
npm start        # Start production server
npm run dev      # Start with nodemon (auto-reload)
npm run db:reset # Wipe DB and recreate schema
```

---

## 📄 License

MIT
