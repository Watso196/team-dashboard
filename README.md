# Team Pulse — ADO Progress Dashboard

A lightweight dashboard for tracking individual team member velocity, activity, and trends directly from Azure DevOps. No build step, no subscription — just HTML + CSS + JS and a one-line Python server.

---

## Files

| File | Purpose |
|------|---------|
| `ado-dashboard.html` | The dashboard markup — config form, layout, and structure |
| `state.js` | Shared mutable state (`CFG`, `RENDER_DATA`) used across modules |
| `constants.js` | All constants — colors, field lists, sizing values |
| `api.js` | ADO API calls, URL/date helpers, WIQL queries, member resolution |
| `data.js` | Data pipeline — `buildDashboard()` and its 12 helper functions |
| `ui.js` | Rendering, charts, tab management, form validation, env pre-fill |
| `dashboard.css` | All styles — dark theme, responsive layout, accessibility utilities |
| `dashboard.test.js` | Jest test suite covering utilities, accessibility, and rendered output |
| `serve.py` | Local HTTP server that reads `.env` and pre-fills the dashboard form |
| `env.example` | Template — copy to `.env` and fill in your values |
| `.env` | Your personal config (PAT, org, team, members) — **never commit this** |
| `.gitignore` | Ensures `.env` and `node_modules/` are excluded from version control |
| `package.json` | Node.js project config for running tests via Jest |

---

## Quick Start

1. Put all files in the same folder.
2. Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
# then open .env in any text editor
```

3. Run the server:

```bash
python serve.py
```

This starts a local server on port `8765`, reads your `.env`, and opens the dashboard with the form pre-filled. If it doesn't open automatically, navigate to:

```
http://localhost:8765/ado-dashboard.html
```

> **Why a local server?** Browsers block API requests from `file://` pages due to CORS. Serving via `localhost` bypasses this. Do not open `ado-dashboard.html` directly from your file system.

---

## Sharing with Other Managers

Each manager gets their own `.env` — the HTML and Python files are identical for everyone. To share:

1. Send (or commit to a private repo) all files **except `.env`**
2. Each manager copies `.env.example` → `.env` and fills in their own org, project, team, PAT, and member list
3. Run `python serve.py` — done

The `.gitignore` already excludes `.env` so it won't be accidentally committed if you use a repo.

---

## Configuration

On first load you'll see a config form. Fill in:

| Field | Example | Notes |
|-------|---------|-------|
| Organization URL | `https://dev.azure.com/YourOrg` | No trailing slash |
| Project Name | `Design` | Exact name, case-sensitive |
| Team Name | `Accessibility` | From **Project Settings → Teams**. Try appending `" Team"` if you get a 404. |
| Sprint Mode | Iterations / Dates | **Iterations** uses ADO iteration paths; **Dates** calculates 2-week sprints from a start date |
| Past Iterations to Load | `12` | How many historical sprints to pull (iterations mode). Metrics are also reported across this full range — see [Timeframes](#timeframes) |
| Sprint Start Date | `2026-03-30` | First day of your most recent sprint (dates mode only) |
| Past Sprints to Load | `12` | How many historical 2-week periods to pull (dates mode only) |
| Personal Access Token | `xxxxxxxxxxxx` | See PAT setup below |
| Team Members | One display name per line | Must match ADO exactly, case-insensitive |
| Related Projects | One project name per line | Additional projects to scan for work items and PRs |
| Design Review Tracking | Toggle on/off | Counts "Design Review" tag add/remove cycles per member (adds load time) |

Config is not saved between sessions — re-enter it each time, or pre-fill via `.env` and `serve.py`.

---

## PAT Setup

1. Go to `dev.azure.com` → click your avatar → **Personal Access Tokens**
2. Click **New Token**
3. Set the following scopes:
   - **Work Items** → Read
   - **Code** → Read
   - **Project and Team** → Read
4. Copy the token and paste it into the dashboard config

Tokens expire — if you get a `401 Unauthorized` error, generate a new one.

---

## Metrics Tracked

### Sprint Summary (current sprint)

| Metric | Source |
|--------|--------|
| Effort points marked Done | Done PBIs/Bugs in current iteration, assigned to member |
| Effort total (all items) | All PBIs/Bugs in iteration assigned to member, regardless of state |
| PBIs touched | PBIs with any change since sprint start date |
| Bugs touched | Bugs with any change since sprint start date |
| Features touched | Features with any change since sprint start date |
| PRs linked to assigned PBIs | Work item `ArtifactLink` relations pointing to pull requests |
| Hours this sprint | Sum of `CompletedWork` on Tasks under current iteration |
| Avg hours per item | Hours ÷ (PBIs + Bugs touched) |
| Avg start → done (3mo) | Days between `Committed`/`Active` and `Done` state transitions, sampled across last 80 completed items |

### Velocity Trends

| Metric | Lookback |
|--------|---------|
| Effort per sprint | This sprint / 3-month avg / 6-month avg / selected-range avg + total |
| Hours per sprint | This sprint / 3-month avg / 6-month avg / selected-range avg + total |
| Items done per sprint | This sprint / 3-month avg / 6-month avg / selected-range avg + total |
| Avg hours per item | This sprint / 3-month avg (estimated) |

Trend data is pulled from all ADO iterations whose start date falls within the lookback window.

### Timeframes

Every windowed metric is reported over **three** scopes side by side:

| Scope | Meaning |
|-------|---------|
| 3-month | Fixed 90-day preset |
| 6-month | Fixed 180-day preset |
| Selected range | Exactly the sprints you asked for in **Past Iterations to Load** / **Past Sprints to Load** |

The selected range is whatever the iteration count resolves to — ask for 20 iterations and you get metrics across all 20, even though that reaches back further than 6 months. Range-scoped rows are marked with a left rule in the member tables, and the team tab gets a dedicated **Selected Range** panel. The header shows the resolved span (e.g. `Loaded: 20 sprints · Nov 3, 2025 – Sep 22, 2026`).

Metrics covered by all three scopes: effort points, items done, hours, PRs authored, PRs reviewed, peer review tasks and hours, PBIs/Bugs created, start→done turnaround, and Design Review cycling.

Queries pull from whichever is earlier — the start of your selected range or 6 months ago — so the fixed presets stay accurate even when you load only a couple of sprints. Loading a long range increases load time roughly in proportion to the number of sprints, mostly from per-item history scans used for turnaround and Design Review tracking.

### PR review comments

The **Load Comments** button on each member tab pulls their review comments across the full selected range. This costs one API call per reviewed PR, so it stays on-demand rather than loading with the dashboard:

- The button shows the cost up front — `↓ Load Comments (87 PRs)`.
- Progress updates per batch (`…35/87 PRs`), and results render as they arrive.
- A **Stop** button cancels mid-fetch and keeps whatever already loaded.
- Comments are sorted newest first and tagged with PR number, repo, and date.

If no range is available the button falls back to the 3-month window.

---

## Work Item Conventions

The dashboard is built around this team's ADO setup:

- **PBI states:** `Committed` = in progress, `Done` = complete
- **Task states:** `In Progress` = in progress, `Done` = complete
- **Hours:** tracked via Task `Completed Work` field (not Original Estimate)
- **Effort points:** tracked via `Story Points` or `Effort` field on PBIs/Bugs
- **Sprints:** defined as ADO Iterations with start and finish dates

If your team uses different state names, update the WIQL queries and state-transition logic in `data.js` and `api.js`.

---

## Troubleshooting

**`Failed to fetch` / CORS error**
You're opening the file directly instead of via the server. Run `python serve.py`.

**`401 Unauthorized`**
Your PAT is invalid or expired. Generate a new one in ADO.

**`404 Not Found`**
Your org URL, project name, or team name is wrong. Double-check them in ADO. Team names sometimes include a suffix like `"Accessibility Team"` — check under **Project Settings → Teams**.

**A team member shows all zeros**
Their display name doesn't match ADO. The dashboard does case-insensitive matching, but the name must otherwise be exact. Check their profile in ADO for the canonical display name.

**No current iteration found**
The team's current sprint either has no start/end dates set, or the iteration isn't assigned to this team. Check **Project Settings → Boards → Team Configuration → Iterations**.

**Completion time shows "no data yet"**
This is calculated from work item update history. It requires PBIs to have gone through a `Committed` or `Active` state before reaching `Done` in the last 3 months. New teams or teams that skip the active state won't have this data.

---

## Known Limitations

- **Avg hours per item (3mo)** shows avg hours per sprint rather than true per-item hours. Tracking per-item counts across historical sprints would require fetching all work item updates for every past sprint, which is too expensive in API calls for a client-side tool.
- **Completion time** samples a maximum of 80 recently-completed items to keep load times reasonable. This is configurable in the source (`sampleIds = recentDoneIds.slice(0, 80)`).
- **PR detection** relies on ADO's `ArtifactLink` relation type. PRs must be explicitly linked to work items in ADO for this to work.
- The dashboard calls the ADO API directly from the browser. For large teams or long histories, load times can be 20–40 seconds due to the volume of API calls.

---

## Customisation

Key areas across the source files:

- **Member accent colors** — `MEMBER_COLORS` array in `constants.js`
- **State names** — WIQL queries in `data.js` referencing `'Done'` and `'Committed'`
- **Completion time concurrency** — `COMPLETION_CONCURRENCY` in `constants.js`
- **Port number** — `PORT = 8765` in `serve.py`
- **Pre-filled defaults** — `value="..."` attributes on form inputs in `ado-dashboard.html`, or via `.env`
- **Styles** — CSS custom properties in `:root` at the top of `dashboard.css`

---

## Testing

Tests use [Jest](https://jestjs.io/) with `jest-environment-jsdom`:

```bash
npm install        # one-time setup
npm test           # run all tests
```

The test suite (`dashboard.test.js`) loads the five JS source files (`state.js`, `constants.js`, `api.js`, `data.js`, `ui.js`) in order and covers:

- **Pure utility functions** — `avg`, `fmt`, `fmtInt`, `esc`, `addDays`, `isoDate`, `normPath`, `buildDateBasedSprints`, `assigneeClause`, `projBadge`
- **HTML structure & accessibility** — landmark regions, skip link, headings, label associations, required field indicators, ARIA attributes, sprint mode radio group, error containers, loading screen
- **JS-generated accessibility** — drillable rows, drill items, SVG chart accessibility, ARIA tabs pattern, tab switching, drill toggling, `fill()` helper
- **Config form validation** — required field checking per sprint mode, mode switching visibility, reset flow
- **Rendered output accessibility** — section heading levels, table captions, keyboard-accessible cards, `aria-expanded` on drills, screen-reader new-tab text on external links

---

## Accessibility

The dashboard follows WCAG 2.1 AA guidelines:

- Semantic HTML landmarks (`<main>`, `<header>`, `<nav>`, `<form>`)
- Skip navigation link
- Proper heading hierarchy (`<h1>`, `<h2>`)
- All form inputs have associated `<label>` elements with `for` attributes
- Required fields marked with `aria-required="true"` and visual indicators
- Hint text linked via `aria-describedby`
- Error regions use `role="alert"` and `aria-live="assertive"`
- Full ARIA tabs pattern with keyboard arrow-key navigation
- Drillable rows and member cards are keyboard-accessible (`role="button"`, `tabindex="0"`)
- SVG charts have `role="img"` and `aria-label` with data summaries
- External links include screen-reader "opens in new tab" text
- `prefers-reduced-motion` and `forced-colors` media query support
- Minimum 4.5:1 color contrast ratios
