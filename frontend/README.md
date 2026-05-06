# TimeBridge — Frontend

React + Vite web client for **TimeBridge**, a web application that helps
family members find suitable times to communicate by sharing and comparing
their schedules.

> Senior Design Project · Computer Science
> Author: **Aimaral Khaumyetbyek** · Repository for academic submission.

The companion backend lives at [`../timebridge-backend`](../timebridge-backend).

---

## Tech stack

| Layer       | Choice                              |
| ----------- | ----------------------------------- |
| UI          | React 18 (function components + hooks) |
| Build       | Vite 5                              |
| Routing     | React Router v6                     |
| State       | React Context (no Redux)            |
| Tests       | Vitest + Node `assert`              |
| Mobile      | Expo Router (under `mobile/`, optional) |

No CSS framework — styling is hand-written in `src/styles/*.css` using CSS
custom properties for the dark/light theme.

---

## Quick start

```bash
git clone <repo>
cd timebridge-frontend
npm install
npm run dev          # http://localhost:5173
```

The dev server expects the backend at `http://localhost:5050` (configured in
`src/api/client.js`). Start the backend first — see `../timebridge-backend/README.md`.

### Available scripts

| Command            | What it does                            |
| ------------------ | --------------------------------------- |
| `npm run dev`      | Vite dev server with hot module reload. |
| `npm run build`    | Production build into `dist/`.          |
| `npm run preview`  | Serve the production build locally.     |
| `npm test`         | Run the Vitest suite once.              |
| `npm run test:watch` | Vitest in watch mode.                 |

---

## Highlights shipped in v1

- **Notes** — short messages between connected family members.
  `NoteModal` from any Family card, full inbox/sent at `/notes`,
  unread badge in the sidebar.
- **Real weather** via Open-Meteo (no API key) — your own weather is
  shown on the Dashboard hero, plus a small temp-and-icon pill on each
  family member's card so you can see what the weather is like *over there*
  before you call.

## Project layout

```
src/
├── api/client.js          REST wrapper around fetch
├── context/
│   ├── AuthContext.jsx    JWT storage + current user
│   ├── ScheduleContext.jsx  Cached schedule blocks, computed status helpers
│   ├── PrefsContext.jsx   Theme + 12/24h preferences
│   ├── NotesContext.jsx   Unread count + polling
│   └── ToastContext.jsx   Lightweight toast notifications
├── pages/
│   ├── Dashboard.jsx      Status, weather, family overview, onboarding checklist
│   ├── AuthPage.jsx       Login / Register / Forgot password (with 2FA step)
│   ├── SchedulePage.jsx   Weekly recurring blocks + .ics import
│   ├── AvailabilityPage.jsx  Per-hour availability override
│   ├── OverlapPage.jsx    "When can we talk?" — ranked shared windows
│   ├── FamilyPage.jsx     Generate / join / delete invite codes + leave a note
│   ├── NotesPage.jsx      Inbox + sent
│   ├── ProfilePage.jsx    Profile + quiet-hours editor
│   └── SettingsPage.jsx   Account + preferences + integrations
├── components/
│   ├── Sidebar.jsx        Vertical nav with tooltips, dropdown, unread badge
│   ├── Modal.jsx          Radix Dialog wrapper
│   ├── Tooltip.jsx        Radix Tooltip wrapper
│   ├── PasswordChangeModal.jsx
│   ├── TwoFactorModal.jsx
│   ├── GoogleCalendarRow.jsx
│   ├── NoteModal.jsx
│   └── WeatherPill.jsx    useWeather hook + compact pill
├── utils/
│   ├── icsParser.js       Minimal RFC 5545 .ics → schedule_block converter
│   ├── overlap.js         coalesceRows + scoreWindow + rankWindows
│   ├── quietHours.js      Per-user quiet-hour storage + window predicate
│   ├── tz.js              wallClockInTz — projects UTC into an IANA zone
│   ├── timeFormat.js      12/24h formatTime helpers
│   ├── timezones.jsx      Timezone select component
│   ├── geoLocate.js       Browser geolocation + Nominatim reverse geocode
│   └── weather.js         Open-Meteo geocoding + forecast (cached in localStorage)
└── styles/                CSS files
```

---

## Testing

Unit tests live next to the code under `src/utils/__tests__/` and cover the
three pieces of pure logic that are most prone to subtle bugs:

| File                  | Coverage                                           |
| --------------------- | -------------------------------------------------- |
| `overlap.test.js`     | `coalesceRows` — empty input, single slot, contiguous merge, gap split, free-set change, 24-hour marathon, immutability of input. |
| `quietHours.test.js`  | `inQuietHours` for both wrapping (22→08) and same-day (09→17) windows; storage round-trip with per-user scoping. |
| `icsParser.test.js`   | RRULE BYDAY parsing, ordinal prefixes, all-day skipping, RFC 5545 line folding, deduplication. |

Run all suites with `npm test`. The current pass rate is **33 / 33**.

---

## API base URL

`src/api/client.js` defines one constant:

```js
const BASE = 'http://localhost:5050'
```

To point the client at a deployed backend, edit this constant or replace it
with `import.meta.env.VITE_API_BASE` for environment-driven configuration.

---

## Authentication flow

1. `AuthPage` posts to `/login` or `/register` and stores the returned JWT in
   `localStorage` under `tb_token`.
2. `AuthContext` exposes the current user and a `logout()` helper.
3. `api/client.js` reads the token on every request and adds an
   `Authorization: Bearer <token>` header.
4. The backend's `authMiddleware` verifies the JWT and sets `req.userId`.

---

## Schedule import (.ics)

`SchedulePage` accepts a `.ics` file from any modern calendar (Google, Apple,
Outlook). The file is parsed entirely **in the browser** by
`utils/icsParser.js` — no upload to the backend. Each timed `VEVENT` becomes a
recurring weekly schedule block; all-day events and TZID conversions are
deliberately skipped to keep the demo logic simple and predictable.

---

## Known limitations

Documented honestly so they can be addressed in the report's Future Work section:

1. **Wall-clock times**, not real timezones, for schedule blocks. The
   schedule editor and ICS import treat times as the user's local clock and
   do not shift if the user later changes their profile timezone.
2. **Browser geolocation** quality varies — the Nominatim reverse-geocode
   endpoint occasionally returns sparse results for small cities.
3. **Mobile app** under `mobile/` mirrors a subset of the web functionality
   for the demo; it is not feature-complete.
4. **No end-to-end tests** (Cypress / Playwright). Only unit tests on pure
   utilities are automated.
