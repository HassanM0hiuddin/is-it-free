// Fetches verdicts from the Is it free? API. Runs in the extension's service
// worker so requests aren't blocked by github.com's content security policy.
const API = "https://is-it-free-pi.vercel.app/api/check";
const TTL_MS = 5 * 60 * 1000;
const MAX_BATCH = 30;
const cache = new Map(); // issue URL -> { at, result }   (single-issue page results)
const verdicts = new Map(); // issue URL -> { at, issue } (per-issue results from list batches)

const fresh = (entry) => entry && Date.now() - entry.at < TTL_MS;

async function getJson(url) {
  try {
    const res = await fetch(url);
    const json = await res.json();
    return res.ok ? { ok: true, data: json } : { ok: false, error: json.error || `HTTP ${res.status}` };
  } catch {
    return { ok: false, error: "Couldn't reach the Is it free? server." };
  }
}

async function check(issueUrl) {
  const hit = cache.get(issueUrl);
  if (fresh(hit)) return hit.result;
  const result = await getJson(`${API}?q=${encodeURIComponent(issueUrl)}`);
  // Only cache successes so a transient failure can be retried.
  if (result.ok) cache.set(issueUrl, { at: Date.now(), result });
  return result;
}

/**
 * Verdicts for many issues in one repo. Returns { ok, issues: { [number]: IssueResult } }.
 * Numbers that come back missing are PRs, closed or unknown issues.
 */
async function checkBatch(repo, numbers) {
  const out = {};
  const todo = [];
  for (const n of numbers) {
    const hit = verdicts.get(`https://github.com/${repo}/issues/${n}`);
    if (fresh(hit)) {
      if (hit.issue) out[n] = hit.issue;
    } else todo.push(n);
  }
  for (let i = 0; i < todo.length; i += MAX_BATCH) {
    const chunk = todo.slice(i, i + MAX_BATCH);
    const result = await getJson(`${API}?q=${encodeURIComponent(repo)}&numbers=${chunk.join(",")}`);
    if (!result.ok) return { ok: false, error: result.error, issues: out };
    const byNumber = new Map(result.data.issues.map((issue) => [issue.number, issue]));
    for (const n of chunk) {
      const issue = byNumber.get(n) || null;
      verdicts.set(`https://github.com/${repo}/issues/${n}`, { at: Date.now(), issue });
      if (issue) out[n] = issue;
    }
  }
  return { ok: true, issues: out };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "check" && typeof msg.url === "string") {
    check(msg.url).then(sendResponse);
    return true; // keep the channel open for the async response
  }
  if (msg?.type === "batch" && typeof msg.repo === "string" && Array.isArray(msg.numbers)) {
    checkBatch(msg.repo, msg.numbers).then(sendResponse);
    return true;
  }
});

// Clicking the toolbar icon opens the web app for the current repo/issue.
chrome.action.onClicked.addListener((tab) => {
  const m = tab.url && tab.url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)(\/issues\/\d+)?/);
  const q = m ? `https://github.com/${m[1]}${m[2] || ""}` : "";
  chrome.tabs.create({ url: `https://is-it-free-pi.vercel.app/${q ? `?q=${encodeURIComponent(q)}` : ""}` });
});
