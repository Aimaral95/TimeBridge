# TimeBridge — Senior Design Report Outline

**Author:** Aimaral Khaumyetbyek
**Course:** Computer Science Senior Design
**Companion repository:** [`../../timebridge-backend`](../../timebridge-backend)

This is a chapter-by-chapter scaffold for the written report. Each section
notes (a) what to write, (b) which files / screenshots / diagrams to point
the reader at, and (c) the senior-design rubric criterion it satisfies.

The defining choice of this outline is to **anchor the entire document on
the personal motivation** ("I want to call my mom but I'm not sure she's
at work or out with friends") rather than on the tech stack. Senior design
committees see plenty of CRUD apps; what makes this submission stand out
is that it solves a real problem the author has, and the report should
make that obvious from page one.

---

## 1. Abstract — half a page

One paragraph that names the problem, the solution, and the result.

Suggested first sentence: *"TimeBridge is a web application that helps
international students and their families find suitable times to talk by
sharing and comparing their schedules across timezones."*

End the abstract with concrete numbers: *"The shipped system supports
N user accounts, M family connections, and ranks shared call windows
across arbitrary group sizes. The algorithm core is covered by a
33-test unit suite (100% pass)."*

---

## 2. Introduction — 2-3 pages

### 2.1 Personal motivation
Lead with the story. The reader needs to feel the problem before the
architecture means anything to them.

> "When I moved from Almaty to attend university abroad, the
> twelve-hour gap between my timezone and my mother's meant that
> every call became a logistical puzzle. *Is she at work? Is she
> asleep? Did she go out with her friends?* Existing tools — group
> chats, shared calendars — solve adjacent problems but not this one."

### 2.2 Target users
- International students separated from family across timezones
- Families with members in non-overlapping work / school schedules
- Anyone who has ever opened a phone, hovered over "call mom," and
  put it down because they didn't know whether it was a good time

### 2.3 Goals & non-goals
*Goals:* surface times when the user and a family member are both free,
respect each person's quiet hours, work without requiring the family
member to install anything heavy, run on a laptop and on a phone.

*Non-goals (explicit, important to write down):* group video calls,
calendar editing, real-time messaging, end-to-end encryption.

---

## 3. Background & Related Work — 1-2 pages

Brief survey. The point isn't a literature review — it's to show the
committee you know what already exists and why it doesn't solve this.

| Existing tool | What it does well        | Why it doesn't solve this              |
| ------------- | ------------------------ | -------------------------------------- |
| World clock   | Shows current time       | Says nothing about availability        |
| Doodle / when2meet | One-off scheduling   | Built for meetings, not ongoing family |
| Shared Google Calendar | Full schedule view | Privacy too coarse — all-or-nothing   |
| Whatsapp / iMessage    | Always-on chat     | Doesn't surface "is now a good time?" |

End the chapter with the **gap statement** in one sentence: *no existing
tool computes the intersection of two people's free windows in a
timezone-aware, privacy-respecting, always-on way.*

---

## 4. System Architecture — 3-4 pages

This is your chance to show you understand layered design.

### 4.1 Overview
**Anchor figure:** the SVG diagram at `docs/architecture.svg`. Reproduce
it as a full-page figure with a caption.

Three tiers, each one paragraph:

- **Client** — React 18 SPA built with Vite. State via React Context
  (no Redux), routing via React Router v6. Hand-written CSS with design
  tokens — see §4.5 for why no Tailwind.
- **Server** — Node.js 18 + Express 5. Stateless, scales horizontally.
  JWT auth with bcrypt password hashing. In-memory token-bucket rate
  limiter on the auth endpoints (acknowledged as needing Redis for
  multi-process deploys; see §9 Future Work).
- **Database** — PostgreSQL 14 accessed via the `pg` driver with
  parameterized queries. No ORM — see §4.5.

### 4.2 Data model
List the five tables with one line of purpose each:

- `users` — accounts + IANA timezone + city/country
- `connections` — invite codes + accepted family links (bidirectional)
- `availability` — one row per UTC hour the user has marked free
- `schedule_blocks` — recurring weekly busy/class blocks, each anchored
  to a `tzid` (added in the v1 timezone fix; see §6.4)
- `password_resets` — short-lived hashed reset tokens

### 4.3 API surface
Full table from `timebridge-backend/README.md` §"REST API". 16 endpoints,
all documented. Highlight the four that carry the load:

- `POST /availability` — bulk replace user's free hours
- `GET  /availability/overlap` — server-side cross-user availability
- `GET  /connections/:otherId/availability` — pairwise comparison
- `POST /schedule` — add a recurring block (now tzid-aware)

### 4.4 Authentication flow
Sequence: register → bcrypt hash → JWT issued → JWT in `localStorage`
under `tb_token` → every subsequent request adds `Authorization: Bearer`
→ middleware verifies and sets `req.userId`. Mention the password-reset
flow (random 32-byte hex, only the SHA-256 hash is stored, 30-min
expiry, response intentionally identical for known and unknown emails
to defeat enumeration).

### 4.5 Deliberate non-choices (defend your design)
- **No ORM.** Parameterized SQL keeps the query layer transparent and
  lets the report show explicit query design. You can read every
  database operation in `server.js` without traversing migrations,
  schema files, and ORM lazy-loading.
- **No CSS framework.** Hand-written CSS with custom properties (CSS
  variables) for the dark-mode design tokens. Demonstrates understanding
  of the underlying primitives a framework would have hidden.
- **No state-management library.** React Context + `useReducer` covers
  the entire app's state needs. Avoids the cognitive overhead of Redux
  or Zustand for a single-purpose app.
- **No realtime layer (yet).** WebSockets / SSE would be needed for
  live presence; deferred to v1.1 because polling on demand suffices
  for the demo and shipping live presence well is a separate project.

---

## 5. Implementation Highlights — 2-3 pages

Pick three. Don't try to describe every file.

### 5.1 ICS calendar import (RFC 5545)
File: `src/utils/icsParser.js`. ~120 lines, hand-rolled. Handles:
- VEVENT extraction
- RRULE FREQ=WEEKLY with BYDAY parsing (including ordinal-prefix
  stripping for `1MO`-style codes)
- RFC 5545 line folding (continuation lines beginning with whitespace)
- Skipping all-day events (`VALUE=DATE`)
- Deduplication of identical recurring events

Quote the test cases from `src/utils/__tests__/icsParser.test.js` —
they're concise and convey what the parser does.

### 5.2 Per-user, browser-side state hygiene
Talk about the `tb_hidden_invites_${userId}` and `tb_quiet_${userId}`
patterns. Two accounts on the same browser must not see each other's
data. Mention the auto-prune behaviour for hidden invites that have
since been accepted.

### 5.3 Optimistic UI with backend fallback
File: `ScheduleContext.jsx` → `addBlock`. Optimistic insert with a
`tmp-${Date.now()}` id, replaced when the server returns the real id.
Show the snippet — about 10 lines. This is a small idiom but it makes
the UI feel instant, which is exactly the kind of detail a senior
design committee notices on demo day.

---

## 6. Algorithms — 3-4 pages **(this is the big chapter)**

This is the most important chapter — and the one most senior design
projects skip. Don't.

### 6.1 The hard problem, framed correctly
*Don't* say "we compute set intersection." That's just the data
structure. The hard problem is:

> Given N users in arbitrary timezones, each with a sparse set of
> 1-hour availability slots and a daily quiet-hours window, surface
> the *best K shared call windows* — where "best" rewards the number
> of family members free, the duration of the window, and a penalty
> for intruding on anyone's quiet hours.

That framing earns you a real algorithms section.

### 6.2 Storage choice
Why **UTC ISO timestamps for availability**, but **wall-clock TIME +
days[] + tzid for schedule_blocks**? Two different reasoning paths,
both worth writing up:

- *Availability* is a one-off "I'm free at this exact hour" — the
  natural representation is an absolute instant (UTC).
- *Schedule blocks* are recurring intentions in the user's *local*
  life — "I have class every Mon/Wed/Fri at 9 AM" doesn't mean
  "9 AM UTC". The right anchor is wall-clock + tzid.

### 6.3 Set intersection
File: `src/utils/overlap.js` → `coalesceRows`. Walk through the
algorithm:

```
for each of MY 1-hour slots:
  collect the set of family members who are also free at that slot
  if non-empty, emit (when, free_set)
```

Then explain the coalescing pass: consecutive 1-hour rows with the
same free-set merge into N-hour windows.

Reference the test cases in `src/utils/__tests__/overlap.test.js` —
they document the edge cases: empty input, contiguous merge, gap
splitting, free-set change, immutability.

### 6.4 Wall-clock timezone correctness
File: `src/utils/tz.js` → `wallClockInTz`. This is the section that
addresses the previously-documented limitation. Walk the reader through
the problem:

> Suppose Alice in Almaty creates a schedule block "9 AM class on
> Mon". The naïve representation stores `09:00` and `['Mon']`. If
> Alice later changes timezone to Paris, the naïve `activeBlock`
> would re-interpret `09:00` as Paris-local — a 5-hour shift in
> the wrong direction.

The fix: store an explicit `tzid` column. The runtime check uses
`Intl.DateTimeFormat` with a forced `timeZone` to project the current
UTC instant into the block's tzid, then compares wall-clock minutes
within that zone. Show the 12-line `wallClockInTz` function and the
five test cases in `src/utils/__tests__/tz.test.js`.

### 6.5 Window ranking
File: `src/utils/overlap.js` → `scoreWindow` and `rankWindows`. This
turns the raw intersection into a ranked list. The score formula:

```
score = peopleFree
        × (1 + log2(hours))            -- diminishing returns on duration
        × (0.6 if intersects any quiet window, else 1)
        × (0.8 if window starts in the past, else 1)
```

Justify each factor. Linear in people because doubling the family
that's free roughly doubles the value of the slot. Logarithmic in
hours because a 4-hour window is better than a 1-hour window but
not 4x better. Multiplicative penalties because they're easier to
reason about than additive ones and they preserve the property that
zero-people windows score zero.

End with the 9 test cases in `overlap.test.js` that pin down the
behavior.

### 6.6 Quiet hours with midnight wrap
File: `src/utils/quietHours.js`. Brief — but worth mentioning that the
predicate handles same-day windows (`09:00 → 17:00`) and wrap-around
windows (`22:00 → 08:00`) symmetrically. 13 tests.

---

## 7. User Interface — 2 pages

Screenshots > prose here. Take a screenshot of:
1. Dashboard with the onboarding checklist visible
2. Family page with one pending invite + one accepted member
3. Overlap page with at least one shared window and the **"Best"** badge
4. Schedule page with at least one block showing its `tzid` chip
5. Auth page with the new gradient background

For each screenshot, one paragraph explaining what the user is seeing
and what design decision the screenshot evidences.

Mention the **two component-library choices**:

- **Lucide React** for icons (replaced inconsistent OS-native emoji)
- **Radix UI primitives** for Tooltip, Dialog, and DropdownMenu
  (focus trap, body scroll lock, animated transitions, ARIA wiring —
  all things a hand-rolled component would have to re-implement)

The rest of the styling is hand-written in `src/index.css` (~400
lines) using CSS variables. Defend that choice in §4.5 if you didn't
already.

---

## 8. Evaluation & Testing — 2 pages **(invest here)**

### 8.1 Unit testing
33 tests across three files (`overlap.test.js`, `quietHours.test.js`,
`icsParser.test.js`, plus the new `tz.test.js`). Pass rate 100%. The
test target was deliberate: the three pieces of pure logic most prone
to subtle bugs (overlap merging, wrap-around quiet hours, RFC 5545
parsing) are tested; the React tree is not.

### 8.2 Manual end-to-end smoke flow
Document the canonical demo flow as five steps with screenshots:

1. Register two accounts in different timezones (e.g. America/Los_Angeles
   and Asia/Almaty)
2. Account A generates an invite code; account B joins with it
3. Both accounts mark availability for the next 7 days
4. Open the Overlap page on either account → shared windows appear,
   ranked, with a "Best" badge on the top entry
5. Verify the highlighted window obeys both users' quiet hours

### 8.3 (Strongly recommended addition before submission) User testing
Even informal user testing with three family members across two
timezones would transform "Future Work" into "Results". Take
screenshots of the real overlap output and put them in the report.

If you don't have time for a full study, even a single screenshot
of "this is what showed up when my actual mother registered and
shared her availability" is worth a paragraph.

---

## 9. Limitations & Future Work — 1-2 pages

Be honest. Senior design committees treat documented limitations as
**a strength**, not a weakness — they show you understand what you
built and what you didn't.

| Limitation                                  | Status            |
| ------------------------------------------- | ----------------- |
| ~~Wall-clock schedule blocks ignore timezone changes~~ | **Fixed in v1** (tzid column + `wallClockInTz`) |
| ~~Privacy controls are UI-only (no backend persistence)~~ | **Fixed in v1** (`privacy_settings` JSONB table + `GET`/`PUT /privacy`) |
| ~~No in-app password change~~               | **Fixed in v1** (`POST /change-password`, modal in Settings) |
| ~~No data export~~                          | **Fixed in v1** (`GET /me/export` returns full JSON dump) |
| ~~No light theme~~                          | **Fixed in v1** (`:root.light` CSS overrides + `PrefsContext`) |
| ~~Time format hardcoded to 24-hour~~        | **Fixed in v1** (12/24-hour preference in Settings) |
| ~~2FA enrolment ships, login challenge does not~~ | **Fixed in v1** (`/login` returns `{ twofa_required: true }` when enabled; client re-submits with the 6-digit code) |
| ~~No Google Calendar import~~               | **Fixed in v1** — read-only OAuth flow under Settings → Integrations. Operator sets `GOOGLE_CLIENT_ID`/`SECRET`/`REDIRECT_URI` |
| In-memory rate limiter doesn't survive process restart | Move to Redis for horizontal scale |
| No email delivery for invite codes          | Codes shared manually; SMTP integration planned |
| Mobile (Expo) app is a subset of the web    | Roadmap: parity with web feature set |
| Wide-open CORS (any origin)                 | Tighten to deployed origin in production |
| No DB migrations tool                       | Schema currently hand-managed (every `ALTER TABLE` uses `ADD COLUMN IF NOT EXISTS`); Knex / Prisma planned |
| No Supertest API integration tests          | Frontend tests exist; backend integration tests on the v1.1 roadmap |
| Google Calendar two-way sync (write)        | Read-only import ships in v1; write access is a different threat model — deferred to v1.1 |
| Apple Calendar (CalDAV)                     | Deliberately not built — would require user's Apple ID app-specific password. `.ics` export covers the use case |
| OAuth tokens stored in plain text           | Encryption at rest (with `.env` key) on v1.1 roadmap |
| ~~No way to leave a quick "thinking of you" message~~ | **Shipped in v1** — `notes` table + `POST /notes`, NoteModal, NotesPage with inbox/sent, sidebar unread badge |
| ~~Hardcoded weather on Dashboard~~          | **Shipped in v1** — Open-Meteo (no API key) for the user and on every connected family card |

For each row, write one sentence explaining the trade-off you made
and one sentence on the planned fix.

---

## 10. Conclusion — half a page

Bring the story back to the opening. Something like:

> *"TimeBridge began as a personal frustration: I wanted to call my
> mother and didn't know if she was at work, asleep, or out with
> friends. The shipped system answers that question by computing
> ranked, timezone-aware shared call windows from the schedules and
> availability of every family member you've connected with. The
> algorithm core is unit-tested, the architecture is layered for
> independent scaling, and the limitations are documented honestly.
> The next version will close the privacy persistence gap and bring
> the mobile app to parity. The first version answers, in one
> ranked list of shared windows, the question I started with."*

---

## Appendices

- **A. Full REST API table** — copy from `timebridge-backend/README.md`
- **B. Database DDL** — copy from `server.js` `ensureSchema()`
- **C. Architecture diagram** — full-page reproduction of `docs/architecture.svg`
- **D. Test output** — paste of `npm test` output showing 33-pass count
- **E. Screenshots** — every step of the demo flow

---

## Suggested writing order

If you only have a few days, write in this order — it produces the
report fastest while front-loading the highest-value sections:

1. §1 Abstract (write last, but draft a placeholder first)
2. §2 Introduction — the personal story
3. §6 Algorithms — the technical depth
4. §4 System Architecture — wraps the algorithms in context
5. §8 Evaluation & Testing — including the user-testing screenshots
6. §9 Limitations & Future Work — be honest
7. §3 Background, §5 Implementation, §7 UI — fill in
8. §10 Conclusion — bring it back to mom
9. §1 Abstract — rewrite now that everything else exists
