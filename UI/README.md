# Orbit: College Algebra companion

Space-themed front end for the math-sync backend (BuildWithGemma). The backend owns the course content, the Gemma tutor, answer verification, and quiz grading; this UI renders it with the star intro, unit pages, and progress tracking.

## Run it

### One process (orbit-integration-B — the demo path)

math-sync's Bun server now serves this UI itself, so there is no separate front-end
process and no proxy:

```
# from BuildWithGemma/math-sync
ollama serve                       # if not already running
$env:PORT = "3112"                 # demo port (keeps 8710 free for a live instance)
bun run server.ts
```

- Orbit:      http://localhost:3112/orbit/
- math-sync:  http://localhost:3112/        (unchanged; both UIs run from one process)

Orbit's `index.html` sets `<base href="/orbit/">` so relative assets resolve under
`/orbit/`, while its root-absolute `/api/*`, `/vendor/*`, `/course-asset/*`, and
`/srs.js` calls hit the backend on the same origin — no proxy needed. `server.js`
below is kept only for the legacy two-process setup.

### Two processes (legacy)

```
# 1. Backend (from BuildWithGemma/math-sync)
ollama serve                       # if not already running
set MATH_SYNC_STAY_ALIVE=1         # optional: survive with no browser open
bun run server                     # port 8710

# 2. Front end (from this folder)
node server.js                     # port 8000
```

Open http://localhost:8000. `server.js` serves the static files and proxies `/api/*`, `/course-asset/*`, and `/vendor/*` to math-sync on 127.0.0.1:8710 so everything is same-origin (math-sync sends no CORS headers, on purpose).

Without the backend the site still runs on a built-in fallback course; lesson text, chat, quizzes, and the calculator all need math-sync.

## What comes from the backend

- Units and lessons: `GET /api/course/outline`, lesson markdown from `GET /api/course/lesson?id=`
- Model info: `GET /api/course` (shown in the top bar and chat header)
- Tutoring: `POST /api/chat` streamed over SSE with tool events, verification badges, and quiz cards
- Quiz grading: `POST /api/quiz/answer` — server-side attempts, answer revealed only after a pass or the third miss
- Calculator (Tools menu): `POST /api/calculate`, the same mathjs path the model's tool uses
- KaTeX for lesson math: the backend's vendored copy via the proxy
- Heartbeat: the UI pings `/api/heartbeat` every 5 s because math-sync exits 30 s after its last client disappears

## Local state

Points, streak, read lessons, and quiz passes live in localStorage. Opening a lesson marks it read (+50 points); each quiz problem passed is +100. Tools › Reset progress clears it.

## Files

- `server.js`: static server + backend proxy
- `index.html`: layout shell
- `style.css`: 5-color palette, square design, intro and focus-mode animations
- `data.js`: backend course loading, fallback course, localStorage state
- `app.js`: intro, transitions, lesson reader, SSE chat, quiz cards
- `assets/stars.mp4`: the background video
- `games.js`: unused legacy game engines, superseded by backend quizzes
