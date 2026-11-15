// Fetches verdicts from the Is it free? API. Runs in the extension's service
// worker so requests aren't blocked by github.com's content security policy.
const API = "https://is-it-free-pi.vercel.app/api/check";
const TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // issueUrl -> { at, result }

async function check(issueUrl) {
  const hit = cache.get(issueUrl);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.result;
  let result;
  try {
    const res = await fetch(`${API}?q=${encodeURIComponent(issueUrl)}`);
    const json = await res.json();
    result = res.ok ? { ok: true, data: json } : { ok: false, error: json.error || `HTTP ${res.status}` };
  } catch {
    result = { ok: false, error: "Couldn't reach the Is it free? server." };
  }
  // Only cache successes so a transient failure can be retried.
  if (result.ok) cache.set(issueUrl, { at: Date.now(), result });
  return result;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "check" && typeof msg.url === "string") {
    check(msg.url).then(sendResponse);
    return true; // keep the channel open for the async response
  }
});

// Clicking the toolbar icon opens the web app for the current repo/issue.
chrome.action.onClicked.addListener((tab) => {
  const m = tab.url && tab.url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)(\/issues\/\d+)?/);
  const q = m ? `https://github.com/${m[1]}${m[2] || ""}` : "";
  chrome.tabs.create({ url: `https://is-it-free-pi.vercel.app/${q ? `?q=${encodeURIComponent(q)}` : ""}` });
});
