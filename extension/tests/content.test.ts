// @vitest-environment node
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SCRIPT = readFileSync(join(__dirname, "..", "content.js"), "utf8");

// Minimal copy of the relevant parts of GitHub's issue page markup.
// Set ISSUE_HTML=/path/to/saved/page.html to run against a real page instead.
const FIXTURE =
  process.env.ISSUE_HTML ? readFileSync(process.env.ISSUE_HTML, "utf8") : `
  <html><body><main>
    <div data-testid="issue-header">
      <h1><bdi data-testid="issue-title">Fix typo</bdi><span>#12</span></h1>
      <div data-testid="issue-metadata-fixed"><span data-testid="header-state">Open</span></div>
    </div>
  </main></body></html>`;

const API_RESPONSE = {
  closed: false,
  health: { medianResponseDays: 2, summary: "Maintainers usually reply in ~2 days" },
  issues: [
    {
      verdict: {
        status: "taken",
        reason: "PR #99 by @dev is open (updated 2 days ago)",
        details: ["2 open PRs reference this issue"],
      },
    },
  ],
};

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
/** Wait until `cond` holds (big real-page fixtures make jsdom slow). */
async function until(cond: () => boolean, timeout = 3000) {
  const start = Date.now();
  while (!cond() && Date.now() - start < timeout) await tick(20);
}

function setup(path = "/acme/app/issues/12", response: unknown = { ok: true, data: API_RESPONSE }) {
  const dom = new JSDOM(FIXTURE, { url: `https://github.com${path}`, runScripts: "outside-only" });
  const w = dom.window as unknown as Window & { eval: (s: string) => void; chrome: unknown };
  (w as unknown as { requestAnimationFrame: (cb: () => void) => void }).requestAnimationFrame = (cb) => setTimeout(cb, 0);
  const calls: string[] = [];
  w.chrome = {
    runtime: {
      lastError: null,
      sendMessage: (msg: { url: string }, cb: (r: unknown) => void) => {
        calls.push(msg.url);
        setTimeout(() => cb(response), 10);
      },
    },
  };
  w.eval(SCRIPT);
  const badge = () => w.document.getElementById("iif-badge");
  return { w, calls, badge };
}

describe("content script", () => {
  it("shows a loading badge next to the Open pill, then the verdict", async () => {
    const { badge, calls } = setup();
    expect(badge()?.textContent).toContain("…");
    expect(badge()?.previousElementSibling?.getAttribute("data-testid")).toBe("header-state");
    await tick();
    expect(badge()?.querySelector(".iif-badge")?.textContent).toBe("🔴 Taken");
    expect(badge()?.querySelector(".iif-reason")?.textContent).toContain("PR #99");
    expect(badge()?.textContent).toContain("Maintainers usually reply");
    expect(calls).toEqual(["https://github.com/acme/app/issues/12"]);
  });

  it("links the badge to the web app", async () => {
    const { badge } = setup();
    await tick();
    expect(badge()?.querySelector("a")?.getAttribute("href")).toBe(
      "https://is-it-free-pi.vercel.app/?q=https%3A%2F%2Fgithub.com%2Facme%2Fapp%2Fissues%2F12",
    );
  });

  it("re-inserts the badge after a re-render without refetching", async () => {
    const { badge, calls } = setup();
    await tick();
    badge()!.remove();
    await tick();
    expect(badge()?.querySelector(".iif-badge")?.textContent).toBe("🔴 Taken");
    expect(calls).toHaveLength(1);
  });

  it("removes the badge after navigating away from an issue", async () => {
    const { w, badge } = setup();
    await tick();
    w.history.pushState({}, "", "/acme/app/pulls");
    w.dispatchEvent(new (w as unknown as typeof globalThis).PopStateEvent("popstate"));
    await tick();
    expect(badge()).toBeNull();
  });

  it("does nothing on non-issue pages", async () => {
    const { badge, calls } = setup("/acme/app/pull/5");
    await tick();
    expect(badge()).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("shows a warning badge when the API fails", async () => {
    const { badge } = setup(undefined, { ok: false, error: "rate limit" });
    await tick();
    expect(badge()?.textContent).toContain("⚠");
    expect(badge()?.querySelector(".iif-badge")?.getAttribute("title")).toBe("rate limit");
  });

  it("hides the badge on closed issues", async () => {
    const { badge } = setup(undefined, { ok: true, data: { ...API_RESPONSE, closed: true } });
    await tick();
    expect(badge()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Issue list pages
// ---------------------------------------------------------------------------

const row = (n: number, repo = "acme/app") => `
  <li><div data-listview-item-title-container="true">
    <h3><a href="https://github.com/${repo}/issues/${n}" data-testid="issue-listitem-title-link"><span>Issue ${n}</span></a></h3>
    <span class="trailingBadgesContainer"></span>
  </div></li>`;

const LIST_FIXTURE =
  process.env.LIST_HTML ? readFileSync(process.env.LIST_HTML, "utf8")
  : `<html><body><ul data-testid="issues-list">${[1, 2, 3].map((n) => row(n)).join("")}${row(9, "other/repo")}</ul></body></html>`;

const verdictFor = (n: number) => ({
  number: n,
  verdict: { status: n % 3 === 0 ? "free" : n % 3 === 1 ? "taken" : "stale", reason: `reason ${n}`, details: [] },
});

function setupList(path = process.env.LIST_PATH ?? "/acme/app/issues", html = LIST_FIXTURE, omit: number[] = []) {
  const dom = new JSDOM(html, { url: `https://github.com${path}?q=label%3A%22good+first+issue%22`, runScripts: "outside-only" });
  const w = dom.window as unknown as Window & { eval: (s: string) => void; chrome: unknown };
  (w as unknown as { requestAnimationFrame: (cb: () => void) => void }).requestAnimationFrame = (cb) => setTimeout(cb, 0);
  const batches: { repo: string; numbers: number[] }[] = [];
  w.chrome = {
    runtime: {
      lastError: null,
      sendMessage: (msg: { type: string; repo: string; numbers: number[] }, cb: (r: unknown) => void) => {
        batches.push({ repo: msg.repo, numbers: msg.numbers });
        const issues = Object.fromEntries(msg.numbers.filter((n) => !omit.includes(n)).map((n) => [n, verdictFor(n)]));
        setTimeout(() => cb({ ok: true, issues }), 10);
      },
    },
  };
  w.eval(SCRIPT);
  const rows = () => [...w.document.querySelectorAll(".iif-row")] as HTMLElement[];
  return { w, batches, rows };
}

describe("content script on issue lists", () => {
  it("checks every row of this repo in a single batch", async () => {
    const { batches, rows } = setupList();
    expect(rows().every((r) => r.textContent === "…")).toBe(true);
    await until(() => batches.length > 0 && rows().every((r) => r.textContent !== "…"));
    expect(batches).toHaveLength(1);
    const titleLinks = (LIST_FIXTURE.match(/data-testid="issue-listitem-title-link"/g) || []).length;
    expect(batches[0].numbers.length).toBe(process.env.LIST_HTML ? titleLinks : 3); // other/repo#9 skipped
    expect(rows().length).toBe(batches[0].numbers.length);
    expect(rows().every((r) => r.previousElementSibling?.tagName === "H3")).toBe(true);
  });

  it("shows the verdict with the reason as a tooltip", async () => {
    const { rows } = setupList();
    await until(() => rows().length > 0 && rows()[0].textContent !== "…");
    const first = rows()[0];
    expect(["🟢 Free", "🟡 Stale claim", "🔴 Taken"]).toContain(first.textContent);
    expect(first.getAttribute("title")).toMatch(/reason \d+/);
    expect(first.getAttribute("href")).toContain("is-it-free-pi.vercel.app/?q=");
  });

  it("drops the badge for rows that aren't open issues", async () => {
    const { batches, rows } = setupList(undefined, undefined, [2]);
    await until(() => batches.length > 0 && rows().every((r) => r.textContent !== "…"));
    expect(rows().map((r) => r.dataset.iifN)).not.toContain("2");
  });

  it("doesn't refetch when GitHub re-renders the list", async () => {
    const { w, batches, rows } = setupList();
    await until(() => rows().length > 0 && rows()[0].textContent !== "…");
    rows().forEach((r) => r.remove());
    w.document.body.append(w.document.createElement("div")); // trigger observer
    await until(() => rows().length > 0);
    expect(batches).toHaveLength(1);
    expect(rows().length).toBeGreaterThan(0);
  });

  it("does nothing on pull request lists", async () => {
    const { batches, rows } = setupList("/acme/app/pulls");
    await tick(250);
    expect(batches).toHaveLength(0);
    expect(rows()).toHaveLength(0);
  });
});
