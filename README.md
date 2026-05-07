# TimeBridge

A web application that helps international students and their families find
suitable times to call across timezones, by computing ranked, timezone-aware
shared call windows from each user's recurring weekly schedule and per-hour
availability.

> Senior Design Project · Computer Science
> Author: **Aimaral Khaumyetbyek**

---

## Live Demo

https://timebridge-0m5k.onrender.com

---

## Repository layout

```
timebridge/
├── frontend/      React 18 + Vite SPA (with Expo mobile under mobile/)
├── backend/       Node.js + Express 5 REST API + PostgreSQL
└── README.md      this file
```

Both subdirectories are self-contained: each has its own `package.json`,
`README.md`, and `.gitignore`. Open them independently in your editor of
choice.

---

## Quick start

You will need Node.js 18+ and PostgreSQL 14+ installed locally.

```bash
# 1. Set up the database (one time)
createdb TimeBridge

# 2. Backend
cd backend
cp .env.example .env       # then edit .env to set PG password + JWT_SECRET
npm install
node server.js             # http://localhost:5050

# 3. Frontend (in a second terminal)
cd frontend
npm install
npm run dev                # http://localhost:5173

# 4. Run the unit tests (frontend)
cd frontend
npm test                   # 51 tests / 100% pass at submission
```

The frontend `src/api/client.js` expects the backend at
`http://localhost:5050`. Change the `BASE` constant there if you point at a
different deployment.

---

## Features

- Timezone-aware shared availability computation
- Ranked overlap recommendations
- Recurring weekly schedules
- Quiet-hours filtering and scoring penalties
- Family connection system with invite codes
- JWT authentication + optional 2FA
- Password reset flow
- RFC 5545 ICS calendar import
- Weather integration using Open-Meteo
- Privacy controls per family member
- Dark/light theme support
- Unit-tested scheduling and timezone algorithms

---

## What's in here

The frontend is a React SPA with hand-written CSS, Lucide icons, and Radix UI
primitives for tooltips, dialogs, and dropdowns. The backend is an Express 5
REST API speaking parameterised SQL to PostgreSQL — no ORM. Authentication is
JWT + bcrypt with a hand-rolled in-memory rate limiter on the auth endpoints
and an RFC-6238 TOTP implementation for the optional 2FA flow.

The algorithmic core lives at `frontend/src/utils/overlap.js`
(`coalesceRows`, `scoreWindow`, `rankWindows`) and
`frontend/src/utils/tz.js` (`wallClockInTz` for IANA-timezone-aware schedule
projection). Both are covered by unit tests under
`frontend/src/utils/__tests__/`.

For the full story — motivation, architecture, algorithms, testing,
limitations — see [`frontend/docs/FINAL_REPORT.md`](frontend/docs/FINAL_REPORT.md)
or the rendered PDF at `frontend/docs/TimeBridge_Final_Report.pdf`.

---

## License

This is a senior design project submission. Code is provided as-is for
academic review. Contact the author for any reuse questions.
