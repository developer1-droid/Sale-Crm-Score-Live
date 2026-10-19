# Score Live

Live TV scoreboard for the Shazia Rice CRM. It shows the **CRM Executive** scores (as the CRM MIS page and the Scoreboard score them) and the **Sales Report** scores as a full-screen animated slideshow, with live updates over Socket.IO, so the page never needs a refresh.

The CRM is not changed in any way. This app logs in like a normal user and reads the same APIs the CRM pages use.

**CRM Executive score:** the CRM board is the CRM MIS page (`/reports/crm-mis`) on the TV: the CRM's MIS engine scores each CRM Executive with a signed miss % and a grade (e.g. **−24.6% C**; 0% is best), over the page's periods (This week, Last week, This month, Last month, or two dates), with the page's KPI cards (Score, On time, Late, Not done, Pending now, Avg delay) and its "Most missed steps" and "Delay reasons". A week or month that has ended is shown as the CRM froze it (`GET /api/mis/periods`, read once), exactly as the page shows it. The numbers match the page for the same period and the same feed; two screens a few minutes apart can differ by a step or two, because steps fall due through the day.

## Setup (one time)

1. Install Node 18 or newer.
2. Copy `.env.example` to `.env` and fill in:
   - `FIREBASE_API_KEY`, `FIREBASE_PROJECT_ID`: the CRM's `NEXT_PUBLIC_FIREBASE_*` values
   - `CRM_EMAIL`, `CRM_PASSWORD`: a CRM login with Super Admin, or with `dept_analytics.view.all` + `sales_report.view.all`
3. Run `npm install`.

## Run

- Double-click `Start Score Live.bat`. It opens Chrome full screen (kiosk mode).
- Or run `npm start` and open http://localhost:4000.
- Demo with sample data: http://localhost:4000/?mock=1
- To show another TV on the same network: `http://<this-PC-IP>:4000`

**What the TV shows:** CRM Executive leaderboard, then **each CRM Executive one by one** (a card per person in rank order: score and grade, on time / late / not done, pending, average delay, the step they miss most and the delay reason they write most — 10 s each by default), then the CRM leader spotlight, then the Sales Coordinator leaderboard, then the Sales leader spotlight, then last month's Sales results. After that it starts again. Order, on/off and time per board are set on the settings page. Whoever is on top has a flame 🔥, the last one gets a little "Push!" coach, and while the voice speaks a cartoon announcer with a mic shows what it is saying.

**Why the TV and the CRM page can show different numbers:** the CRM page remembers its own period filter. If the page is on *This week* and the TV on *This month*, every number differs. Pick the same period on both (filter bar on the TV, or the default on the settings page). Steps fall due through the day, so two screens a few minutes apart can differ by a step or two.

### Period filters

The filter bar at the top of the TV switches the period instantly on that screen:

- **CRM:** This week · Last week · This month · Last month · Custom — the CRM MIS page's periods (IST Monday–Sunday weeks and calendar months). The Custom chip shows the From–To dates chosen on the settings page (it is hidden until both are set). A TV set to an old period (Weekly, Monthly …) reads it as the nearest one (This week, This month).
- **Sales:** Today · This week (from Monday) · This month (from the 1st) — same as the Sales Report page, including its 20% client-feedback rule for the cash reward ("got 8 · need 3" under Client Feedback; **Not eligible** / **On hold** in the Reward column).

"Set as default" saves the chosen period for every TV. All periods are computed on every poll, so switching never waits for the CRM.

### Settings page

Open `/settings.html` (or press **S** / the gear button on the TV). Everything there is saved on the server in `data/settings.json` and applies live to every TV:

theme (dark / light / auto) · default CRM and Sales period · rotate on/off or stay on one board · board order (drag, or ↑/↓) · each board on/off and its seconds on screen (3–300) · animation on/off, style (slide, fade, zoom, flip, wipe) and speed (0.5×–2×) · rows per page (0 = fit the screen) and seconds per page · show filter bar · show ticker · voice.

### Voice

The board can read itself aloud, free. On the settings page:

- **This screen speaks** is per screen (saved in that browser); everything else is shared by every TV.
- **Speak automatically** at the chosen times, every day or on chosen days. **Follow the slides** reads each board as it comes on screen, for one full cycle, so the voice always matches what is shown and the periods on screen; **One summary** reads CRM and Sales together. **Non-stop** reads every slide all day.
- What it says (top performers with their score and grade, delays with how late and the step missed most, lowest score, team totals, advance/balance due), names per list, Hindi or English, tone of words, who speaks, an alert tone, volume, speed and pitch. **Test** plays the draft.
- **Who speaks:** *Online voice (server)* (default, recommended for TVs) — `GET /api/tts` (`lib/tts.js`) makes the MP3 with Microsoft Edge's free online neural voices (Hindi: Swara, English: Neerja), and with Google Translate's voice when Edge refuses; the server PC needs internet. *Auto* — this screen's own voice when it has a working one, else the online voice. *This screen's voice* — the browser's own voice. A browser voice that stays silent (Android TVs often list a Hindi voice they cannot play) hands the rest to the online voice, and that screen remembers it; if the online voice fails, the browser's voice takes over, so a screen never plays only the bell.

- **What it says about the CRM board:** who is top, their minus score, grade and average delay (with a fanfare), the next ones, who is late and by how much, the step missed most, the last one with their delay (with a "push" drum roll), and the team's score. On the one-by-one board it reads each person's card as it comes up. **Celebration sounds** switches the fanfare and the push off.

`GET /health` shows the last voice made (`tts.lastOk`: edge or google) and the last failure (`tts.lastError`). Screens report script and voice errors to the server's console through `POST /api/client-log`.

Press **V** on a board to hear it now. Browsers only let a page speak after someone clicks on it once; a kiosk TV can skip that with Chrome's `--autoplay-policy=no-user-gesture-required`.

**PIN:** set `SETTINGS_PIN=1234` in `.env` and the settings page asks for it before saving. Without a PIN anyone on the network can change the settings. After 5 wrong PINs in 10 minutes from one machine, saving is blocked for the rest of those 10 minutes (HTTP 429).

### Full screen

Click the full-screen button (top right, hides when the mouse is idle) or press **F**. `Start Score Live.bat` already opens Chrome in kiosk mode.

## How it works

```
CRM (Vercel) --poll every POLL_SECONDS--> server.js --socket.io 'scores'--> TV browser
```

| Part | What it does |
|---|---|
| `lib/crmClient.js` | Firebase login, then `/api/auth/login` for the session cookie. Logs in again when it gets a 401. |
| `lib/poller.js` | Fetches the CRM Executive sources — the CRM's step feed (`/api/step-feed`: every board's steps as the boards show them, one call), the report rules (`/api/rules/resolved`), `/api/teamSheets`, the payment-pending reports, the Firestore cutoff dates, and the frozen record of each ended week or month on screen (`/api/mis/periods`, read once and kept) — and `/api/sales-coordinator-report` four times (today, this week, this month, last month). Builds the CRM board for every period; `recompute()` redraws it at once when the custom dates are saved. If a source or a period fails, it keeps the last good copy; a feed the CRM built without one of its boards, or only with the login's own steps, is refused the same way. |
| `lib/settings.js`, `lib/settingsRoutes.js` | Settings defaults, validation and atomic save to `data/settings.json`; `GET`/`PUT /api/settings`. |
| `engine/` | `crmMis.js` = the CRM MIS page for the TV: its periods, the MIS engine's board (or the frozen record), the page's average delay, and each person's worst step and top delay reason. It runs on the CRM's own code, copied by `npm run sync-crm` (`tools/sync-crm.mjs`) from the CRM checkout into `engine/crm/lib/**` (same paths as in the CRM; `engine/crm/SOURCE.json` names the commit), together with the CRM's own Score Live board files (`crmBoard.js`, `crmMisBoard.js`, `crmPeriods.js`). `salesReport.js` shapes the Sales Report page's API answer, including its 20% client-feedback rule. |
| `public/` | The TV slideshow. Plain HTML/CSS/JS, no build step. |

Other endpoints: `GET /api/scores` returns the latest payload (`crm.byPeriod`, `sales.byPeriod`, `sales.previous`), `GET /api/settings` / `PUT /api/settings` (header `x-settings-pin` when a PIN is set), `GET /health` returns status per source. Socket events: `settings`, `scores`.

**When the CRM scoring logic changes:** pull the CRM checkout, then run `npm run sync-crm` (reads `C:/Users/xyz/Desktop/CRM-APP-HRE-16`, or `CRM_SRC`, or a path argument; it rewrites `engine/crm/` and the three board files, and stops with an error naming any import it cannot copy). Then `npm run selftest` (`LIVE_DIR=<dir>` runs it over answers saved with `tools/fetch-crm.mjs`) and restart the server. `npm test` checks the voice.
