# How "Is it free?" works: a learning guide

This guide explains the whole project from start to finish: what it does, what each piece is
for, how a request travels through the system, and why things were built the way they were.
Read it top to bottom once, then use it as a map while you read the code.

> File references look like `src/lib/classify.ts` → `classify()`. Open the file and search for the
> function name.

---

## 1. What the project is

New open-source contributors look for issues labelled **"good first issue"**. Often that issue is
already being worked on: someone commented "can I take this?", or a pull request (PR) is already
open. The beginner only finds out after spending an hour reading code.

**Is it free?** checks that for you. For each beginner issue it gives one of three answers:

| Status | Meaning |
|---|---|
| 🟢 **Free** | Nobody claimed it, nobody outside the team is assigned, no open PR |
| 🟡 **Stale claim** | Someone claimed it or opened a PR, then went quiet for 14+ days (30+ for PRs) |
| 🔴 **Taken** | Active PR, recent claim, outside assignee, a "(taken)" label, or a merged PR |

There are **two ways to use it**:
1. **Web app:** https://is-it-free-pi.vercel.app. Paste a repo (`rust-lang/rust`) or an issue link.
2. **Chrome extension:** shows the badge directly on GitHub issue pages and issue lists.

Both use the **same backend API**, so the "brain" lives in one place.

---

## 2. The big picture

```
                          ┌─────────────────────────────── Vercel (cloud) ───────────────────────────────┐
                          │                                                                              │
 ┌──────────────┐  HTTP   │  ┌───────────────┐    ┌──────────────┐    ┌─────────────┐   ┌─────────────┐  │      ┌──────────────┐
 │  Web browser │ ──────▶ │  │ Next.js page  │──▶ │  check.ts    │──▶ │  github.ts  │──▶│ classify.ts │  │ ───▶ │  GitHub API  │
 │  (web app)   │ ◀────── │  │ /  or         │    │ (orchestrate │    │ (fetch data)│   │ (decide     │  │ ◀─── │ GraphQL+REST │
 └──────────────┘         │  │ /api/check    │    │  + cache)    │    │             │   │  status)    │  │      └──────────────┘
                          │  └───────────────┘    └──────────────┘    └─────────────┘   └─────────────┘  │
 ┌──────────────┐  HTTP   │         ▲                                                                    │
 │   Chrome     │ ────────┼─────────┘   (the extension calls /api/check too)                             │
 │  extension   │         └──────────────────────────────────────────────────────────────────────────────┘
 └──────────────┘
```

In one sentence: **something asks `/api/check` about a repo or issue → the server fetches the issue
data from GitHub → a set of rules decides Free / Stale / Taken → the answer goes back as JSON →
the web page or extension draws the badge.**

---

## 3. Tools and technologies (and why each one)

### Core
| Tool | What it is | Why it's used here |
|---|---|---|
| **TypeScript** | JavaScript with types | Catches mistakes before running (e.g. misspelled fields in GitHub's data). |
| **Next.js 16** | React framework that runs code on both the server and in the browser | One project gives us the website **and** the API (`/api/check`). |
| **React 19** | UI library | Builds the web app's interface (input box, filter chips, issue cards). |
| **Tailwind CSS 4** | Utility-class CSS (`className="rounded-xl px-4"`) | Fast styling, dark mode with `dark:` classes, no separate CSS files. |
| **Node.js** | JavaScript runtime | Runs Next.js, the tests and the build. |

### Data
| Tool | What it is | Why it's used here |
|---|---|---|
| **GitHub GraphQL API** | One endpoint where you describe exactly which fields you want | Gets issues + assignees + labels + linked PRs in **one** request instead of hundreds. |
| **GitHub REST API** | Classic URL-per-resource API | Used for comment **text**, because GraphQL is ~10x slower for that (see §8). |

### Extension
| Tool | What it is | Why it's used here |
|---|---|---|
| **Chrome Extension, Manifest V3** | The current format for Chrome extensions | Lets us add badges inside github.com pages. |

### Quality and delivery
| Tool | What it is | Why it's used here |
|---|---|---|
| **Vitest** | Test runner (like Jest, but faster with modern tooling) | 67 automated tests. |
| **jsdom** | A fake browser DOM inside Node | Tests the extension against real GitHub page HTML without opening Chrome. |
| **ESLint** | Code linter | Flags bugs and bad patterns. |
| **Vercel** | Hosting for Next.js apps | Runs the website and API; `npx vercel deploy --prod`. |
| **Git + GitHub** | Version control and code hosting | Public repo for your profile. |
| **GitHub CLI (`gh`)** | GitHub from the terminal | Used to create the repo, and `gh auth token` gives a token for local development. |

---

## 4. Folder map

```
is-it-free/
├── src/
│   ├── app/                      ← Next.js "App Router": every folder is a URL
│   │   ├── page.tsx              ← the "/" page (server side). Handles shared links /?q=...
│   │   ├── checker.tsx           ← the interactive UI (runs in the browser): input, chips, cards
│   │   ├── layout.tsx            ← <html>/<body> wrapper, fonts, page title
│   │   ├── globals.css           ← Tailwind import + light/dark colors
│   │   └── api/check/route.ts    ← the API: GET /api/check?q=...  (&numbers=... for batches)
│   └── lib/                      ← plain TypeScript logic, no UI
│       ├── parse.ts              ← turns "rust-lang/rust" or an issue URL into {owner, name, number}
│       ├── github.ts             ← every call to GitHub (GraphQL + REST), label detection
│       ├── classify.ts           ← THE BRAIN: rules that decide Free / Stale / Taken
│       ├── check.ts              ← glues it together: parse → fetch → classify → cache
│       └── __tests__/            ← unit tests for the above
├── extension/                    ← the Chrome extension (plain JavaScript, no build step)
│   ├── manifest.json             ← tells Chrome what the extension is and where it runs
│   ├── content.js                ← runs INSIDE github.com pages, draws the badges
│   ├── content.css               ← badge + hover-card styles (uses GitHub's own color variables)
│   ├── background.js             ← "service worker": talks to our API, caches answers
│   ├── icons/                    ← 16/48/128 px PNG icons
│   ├── tools/gen-icons.mjs       ← script that draws the icons (no image editor needed)
│   └── tests/content.test.ts     ← extension tests using jsdom
├── docs/                         ← screenshots + this guide
├── next.config.ts                ← Next.js settings (cacheComponents on)
├── vitest.config.ts              ← where tests live
├── .env.example                  ← shows which environment variable is needed (GITHUB_TOKEN)
└── .vercelignore                 ← keeps extension/ out of the website deploy
```

---

## 5. End-to-end flow A: someone uses the web app

**Scenario:** you open the site, type `microsoft/vscode`, and click **Check**.

### Step 1: the browser (`src/app/checker.tsx`)
- `checker.tsx` starts with `"use client"`, which means **this component runs in the browser**.
- Clicking **Check** calls `run(input)`. It:
  1. sets `loading = true`, so the skeleton cards and "Reading comments…" message show
  2. updates the address bar to `/?q=microsoft/vscode` with `history.replaceState`, so the link is shareable
  3. calls `fetch("/api/check?q=microsoft%2Fvscode")`

### Step 2: the API route (`src/app/api/check/route.ts`)
- A file named `route.ts` inside `app/api/check/` automatically becomes the URL `/api/check`.
- `GET()` reads `q` (and `numbers`, if present) from the URL, calls `check(q)`, and returns JSON.
- This code runs **on Vercel's server**, never in the user's browser. That matters because it uses
  the secret `GITHUB_TOKEN`, which must never reach the browser.

### Step 3: orchestration (`src/lib/check.ts` → `check()`)
1. `parseTarget(q)` (`parse.ts`) works out what you typed:
   - `microsoft/vscode` → `{ kind: "repo", owner: "microsoft", name: "vscode" }`
   - `https://github.com/x/y/issues/12` → `{ kind: "issue", ..., number: 12 }`
   - nonsense → `null` → error 400 "Enter a repo like…"
2. **Cache check:** if the same question was answered less than 5 minutes ago, it returns the saved answer
   immediately (§9).
3. Otherwise it calls `fetchRepoIssues()` (or `fetchSingleIssue()` for one issue).

### Step 4: fetching from GitHub (`src/lib/github.ts`)
`fetchRepoIssues()` does this:

1. **Find the beginner labels.** `findBeginnerLabels()` asks GitHub for labels matching keywords
   (`first`, `easy`, `beginner`, `starter`, `junior`…). Then the regex `BEGINNER_LABEL` keeps the
   real ones, so `E-easy` is kept and `D-newcomer-roadblock` is rejected. Labels like
   `good first issue (taken)` are excluded by `TAKEN_LABEL`. The result is cached for 24h.
2. **Two GraphQL queries run at the same time** (`Promise.all`):
   - **Query A (`ISSUE_META`):** the newest 30 open issues with those labels, plus title, author,
     assignees, labels, and the comment list (who and when, **not** the text).
   - **Query B (`ISSUE_TIMELINE`):** each issue's timeline: cross-referenced PRs, connected PRs,
     and assignment events.
3. As soon as Query A returns, **`hydrateBodies()`** fetches comment **text** over REST, 10 issues
   at a time, and only for issues where someone outside the team commented
   (`needsCommentBodies()`). This overlaps with Query B, so no time is wasted.
4. The two results are merged by issue number into a list of `RawIssue` objects.

### Step 5: deciding the status (`src/lib/classify.ts` → `classify()`)
For each issue, the rules run in a fixed order. The full logic is in §7.
`knownMaintainers()` first collects everyone who acted as a maintainer (OWNER / MEMBER / COLLABORATOR)
so their comments and assignments aren't mistaken for claims.

`repoHealth()` also measures how many days maintainers usually take to reply (the median),
which becomes "Maintainers usually reply in ~3 days".

### Step 6: the answer goes back
`check()` builds a `CheckResponse`: repo info, labels, issues with verdicts, and health. It
caches it and returns it. `route.ts` sends it as JSON. `checker.tsx` stores it with `setData(json)`.
React re-renders, which draws the filter chips, counts, and one `IssueCard` per issue,
sorted Free → Stale → Taken.

---

## 6. Flows B, C and D

### B. Opening a shared link (`/?q=rust-lang/rust`): server rendering
- `src/app/page.tsx` is a **Server Component**: it runs on the server.
- It wraps the results in `<Suspense>`. The page "shell" (title and input box) appears instantly, and the
  results **stream in** when ready.
- `Results()` calls `await connection()`. This tells Next.js "this part depends on live data,
  don't pre-build it at deploy time". Then it calls `check()` **directly** (no HTTP round-trip, since it's
  already on the server) and passes the data to `<Checker initialData=...>`.
- Result: shared links open with results already on the page.

### C. Extension on an issue page
```
github.com/rust-lang/rust/issues/164909
        │
        ▼
content.js (inside the page)          background.js (service worker)           our API
  load(): URL is an issue?  ──message──▶  check(url): cached? else fetch ──HTTP──▶ /api/check?q=<issue url>
  shows "Is it free? …"     ◀──reply────  returns { ok, data }          ◀──JSON──
  render(): badge next to the "Open" pill + hover card
```
- **`manifest.json`** says: run `content.js` + `content.css` on `https://github.com/*`, run
  `background.js` as the service worker, and allow calls to `is-it-free-pi.vercel.app`.
- **Why two scripts?** `content.js` lives inside github.com, and GitHub's **Content Security Policy
  (CSP)** blocks that page from calling other websites. The **background service worker** isn't
  bound by the page's rules. It has `host_permissions` for our API. So the content script sends a
  **message** (`chrome.runtime.sendMessage`), and the background script does the network call and replies.
- **Where the badge goes:** `findAnchor()` looks for `[data-testid="header-state"]` (GitHub's green
  "Open" pill) and inserts the badge after it.
- **Hover card:** GitHub's header has `overflow: hidden`, which used to cut the card off. The card is now
  `position: fixed`, and `place()` positions it under the badge whenever you hover.

### D. Extension on an issue **list** page (batching)
- `renderList()` finds every row via `a[data-testid="issue-listitem-title-link"]` and reads the
  issue number from each link.
- Rows that don't have an answer yet go into a **queue**. After 150 ms, `flushQueue()` sends **all of them
  in one message**: `{ type: "batch", repo, numbers: [...] }`.
- `background.js` → `checkBatch()` calls `/api/check?q=owner/repo&numbers=1,2,3` (up to 30 per call).
- On the server, `checkBatch()` (`check.ts`) → `fetchIssuesByNumber()` (`github.ts`) builds **one
  GraphQL query with aliases**:
  ```graphql
  i164909: issue(number: 164909) { ... }
  i163973: issue(number: 163973) { ... }
  ```
  If a number is actually a pull request, GitHub returns a partial error for just that alias. The
  `allowMissing` option in `gql()` accepts the partial data instead of failing the whole batch.
- Each row gets a compact badge, and the reason is shown as a tooltip.

### Keeping badges alive on GitHub (applies to C and D)
GitHub is a **single-page app**: clicking a link changes the URL **without reloading the page**, and
React constantly re-draws parts of the page, which can delete our badge. So `content.js` uses a
**`MutationObserver`** (it fires whenever the page's HTML changes), throttled with
`requestAnimationFrame`. It re-runs `refresh()`, which re-inserts missing badges from memory, without
calling the API again.

---

## 7. The brain: how the classifier decides (`classify.ts`)

Rules are checked **in this order**, and the first one that matches wins:

```
1. Open PR updated in the last 30 days?            → 🔴 Taken  "PR #123 by @x is open"
   Merged PR but the issue is still open?          → 🔴 Taken  "probably fixed"
2. A label like "good first issue (taken)"?        → 🔴 Taken
3. Someone claimed or was assigned, AND active
   in the last 14 days?                            → 🔴 Taken  "@x asked to work on it"
4. Someone claimed, was assigned, or opened a PR,
   but went quiet?                                 → 🟡 Stale  "politely ask to take over"
5. None of the above                               → 🟢 Free   (+ warnings, e.g. "open 5 years, 40 comments")
```

**Important details:**
- **Detecting a claim:** `looksLikeClaim()` runs regexes (`CLAIM_PATTERNS`) for phrases like "can I
  work on this", "assign me", "/assign", "I'd like to…", "I'm working on it". Quoted lines (`> ...`)
  are ignored, so a reply quoting someone else doesn't count.
- **Withdrawing a claim:** "I can't continue", "feel free to take it" (`UNCLAIM_PATTERNS`) remove it.
- **Maintainers are ignored as claimants:** a maintainer saying "I'll take a look" isn't a claim, and
  staff assigned as area owners don't count as "taken".
- **Only same-repo PRs count:** a fork that merely mentions the issue is noise.
- **"Last active"** is the latest of: their comments, their assignment, and their PR updates.
- Thresholds are constants at the top: `CLAIM_STALE_DAYS = 14`, `PR_STALE_DAYS = 30`.

This is a **heuristic** (rules of thumb), not AI. It's fast and free to run, and every decision
comes with a human-readable reason.

---

## 8. Performance: how speed was improved

The first version took **15–28 seconds** for a big repo. The steps that brought it down to roughly 4–9s on a first lookup, and instant on a repeat:

1. **Measured first.** Timing each piece showed that asking GraphQL for comment **bodies** took ~27s,
   while the same data **without** bodies took ~2s.
2. **Moved bodies to REST.** Fetching comment text via REST, 10 requests in parallel, took ~2.5s.
3. **Only fetch bodies when needed.** An issue with no outside comments can't contain a claim.
4. **Parallel queries.** Comments and timelines are fetched at the same time.
5. **Overlap.** REST body-fetching starts the moment the comment list arrives, while the timeline
   query is still running.
6. **Caching** (§9).

Lesson: **measure before optimizing.** The slow part wasn't where you'd guess.

---

## 9. Caching (why repeat lookups are instant)

| Where | What | How long | File |
|---|---|---|---|
| Server | Full answers per repo / issue / batch | 5 min | `check.ts` (`cache`, `batchCache`) |
| Server | Beginner label names per repo | 24 h | `github.ts` (`labelCache`) |
| Extension | Answers per issue | 5 min | `background.js` (`cache`, `verdicts`) |

These are simple in-memory `Map`s holding `{ at: timestamp, data }`. Each server instance has its own memory,
and that's fine at this scale. A bigger app would use Redis.

Caching also saves **GitHub API quota**: a token gets 5,000 requests per hour.

---

## 10. Deployment and configuration

- **Hosting:** Vercel. Deploy from the project folder with `npx vercel deploy --prod --yes`.
  (Auto-deploy on every push isn't connected yet.)
- **Secret:** `GITHUB_TOKEN` is set in Vercel → Project → Settings → Environment Variables.
- ⚠️ **Hard-won lesson:** it must be a **classic token with no scopes** (`ghp_…`). **Fine-grained
  tokens (`github_pat_…`) are silently not shown "this PR mentions this issue" events**, so
  every PR went undetected in production while everything worked locally. The fix was found by
  deploying a temporary debug endpoint and comparing what GitHub returned. The server now logs a warning
  if a fine-grained token is used (`authHeaders()` in `github.ts`).
- **Local development:** `GITHUB_TOKEN=$(gh auth token) npm run dev` → http://localhost:3000.

---

## 11. Testing

Run everything with `npm test`. There are 67 tests:

| File | What it checks |
|---|---|
| `src/lib/__tests__/classify.test.ts` | Each classifier rule with fake issues: open PR → taken, old claim → stale, claim withdrawn → free, maintainer comments ignored… plus claim phrases, label names, response-time math |
| `src/lib/__tests__/parse.test.ts` | Every input format: `owner/repo`, full URLs, `.git`, `#comment` links, bad input |
| `extension/tests/content.test.ts` | Loads `content.js` into **jsdom** with a fake `chrome.runtime`, then checks that the badge appears in the right place, survives re-renders, disappears on navigation, and batches list rows |

**Testing against real GitHub HTML:** save a GitHub page and point the tests at it:
```bash
MSYS_NO_PATHCONV=1 LIST_HTML=path/to/saved-list.html LIST_PATH=/rust-lang/rust/issues npx vitest run extension
```
(`MSYS_NO_PATHCONV=1` stops Git Bash on Windows from turning `/rust-lang/...` into a Windows path.
That bug cost some time.)

Other checks: `npx tsc --noEmit` (types), `npm run lint` (ESLint), `npm run build` (production build).

---

## 12. Concepts worth learning (glossary)

| Concept | Short explanation | Where you see it |
|---|---|---|
| **REST vs GraphQL** | REST: one URL per thing. GraphQL: one URL, and you describe the shape of the data you want | `github.ts` |
| **GraphQL aliases** | Ask for the same field many times with different names (`i12: issue(number:12)`) | `fetchIssuesByNumber()` |
| **Promise.all** | Run several async tasks at once and wait for all of them | `fetchRepoIssues()` |
| **Concurrency limit / worker pool** | Run N tasks at a time, not all 100 at once | `hydrateBodies()` |
| **Server vs Client Components** | Server: runs on the server, can use secrets. Client (`"use client"`): runs in the browser, can use state and clicks | `page.tsx` vs `checker.tsx` |
| **Suspense / streaming** | Show the page shell now, stream slow parts later | `page.tsx` |
| **Route Handler** | A file that becomes an API endpoint | `app/api/check/route.ts` |
| **Environment variables** | Secrets/config kept outside the code | `GITHUB_TOKEN` |
| **Content script** | Extension code that runs inside a website's page | `content.js` |
| **Service worker (MV3)** | Extension background code with no page; wakes up for events | `background.js` |
| **CSP** | A website's rules about what its pages may load or call | why `background.js` does the fetch |
| **Message passing** | `chrome.runtime.sendMessage` between content script and background | both extension files |
| **SPA navigation** | URL changes without a page reload | why `MutationObserver` is needed |
| **MutationObserver** | Browser API that fires when the DOM changes | `content.js` |
| **Regular expressions** | Text pattern matching | `CLAIM_PATTERNS`, `BEGINNER_LABEL` |
| **Heuristics** | Practical rules instead of perfect knowledge | `classify()` |
| **Median** | Middle value; ignores extreme outliers better than the average | `repoHealth()` |
| **In-memory cache with TTL** | Save results with a timestamp; expire after N minutes | `check.ts`, `background.js` |
| **jsdom** | Simulated browser for tests | extension tests |

---

## 13. Interview talking points

- **The problem:** beginners waste time on issues that are already taken. In vscode only 3 of 30 "good first
  issues" were actually free.
- **Architecture:** one Next.js app serves both the UI and the API, and the Chrome extension reuses the same API.
  The logic is split into fetch (`github.ts`), decide (`classify.ts`) and orchestrate (`check.ts`), which makes the
  decision rules easy to unit-test without network calls.
- **Performance story:** profiled GraphQL and found comment bodies were the bottleneck (27s vs 2s), moved them to
  parallel REST calls fetched only when needed, overlapped them with the timeline query, and added caching.
- **Production debugging story:** PR detection worked locally but not in production. Traced it with a
  temporary debug endpoint to fine-grained tokens hiding cross-reference events, then fixed it and documented it.
- **Extension engineering:** CSP forced the network calls into the service worker. GitHub's SPA navigation and
  React re-renders were handled with a throttled MutationObserver. List pages are batched into one request.
  A clipped hover card was fixed with fixed positioning.
- **Quality:** 67 tests, including extension tests that run against real GitHub HTML.
- **Honest limits:** the rules can miss unusual wording, and a first lookup on a huge repo takes a few seconds.
  Next steps would be detecting PRs mentioned only in comments and an optional AI fallback.

---

## 14. Learn by doing (exercises)

Try these yourself, from easiest to hardest. Run `npm test` after each.
1. **Change a threshold:** make claims go stale after 7 days instead of 14 (`CLAIM_STALE_DAYS`). Which test
   breaks, and why?
2. **Add a claim phrase:** make "I'll give this a shot" count as a claim. Add it to `CLAIM_PATTERNS` and
   add a test case in `classify.test.ts`.
3. **Add a beginner label:** support a label called `first-good-bug`. Edit `BEGINNER_LABEL` and the
   `isBeginnerLabel` tests.
4. **UI tweak:** show the number of linked PRs as a small chip on each `IssueCard` in `checker.tsx`.
5. **Medium:** detect PRs that are only *mentioned in comments* (e.g. "see #456"). Parse comment
   bodies for `#123` or `/pull/123`, then check whether those numbers are open PRs.
6. **Harder:** add a "Find free issues" page that searches several repos at once by language.

---

## 15. Command cheat sheet

```bash
# run locally (uses your GitHub CLI login as the token)
GITHUB_TOKEN=$(gh auth token) npm run dev        # → http://localhost:3000

npm test                 # all 67 tests
npx tsc --noEmit         # type check
npm run lint             # lint
npm run build            # production build

npx vercel deploy --prod --yes                   # deploy the website/API
node extension/tools/gen-icons.mjs               # regenerate extension icons

# try the API directly
curl "https://is-it-free-pi.vercel.app/api/check?q=rust-lang/rust"
curl "https://is-it-free-pi.vercel.app/api/check?q=rust-lang/rust&numbers=164909,163973"
```

**Reload the extension after changing it:** `chrome://extensions` → the ↻ icon on "Is it free?".
