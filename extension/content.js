// Adds a free / stale / taken badge to GitHub issue pages.
(() => {
  const BADGE_ID = "iif-badge";
  const SITE = "https://is-it-free-pi.vercel.app";
  const STATUS = {
    free: { label: "Free", emoji: "🟢" },
    stale: { label: "Stale claim", emoji: "🟡" },
    taken: { label: "Taken", emoji: "🔴" },
  };

  let currentUrl = null; // issue URL the badge currently represents
  let lastResult = null;

  /** "https://github.com/o/r/issues/12" for issue pages, otherwise null. */
  function issueUrlFromLocation() {
    const m = location.pathname.match(/^\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?$/);
    return m ? `https://github.com/${m[1]}/${m[2]}/issues/${m[3]}` : null;
  }

  /** Where to put the badge: next to the Open/Closed pill, else after the title. */
  function findAnchor() {
    const state = document.querySelector('[data-testid="issue-metadata-fixed"] [data-testid="header-state"]')
      || document.querySelector('[data-testid="header-state"]')
      || document.querySelector(".gh-header-meta .State");
    if (state) return { el: state, where: "afterend" };
    const title = document.querySelector('[data-testid="issue-title"]') || document.querySelector(".js-issue-title");
    const h1 = title && title.closest("h1");
    if (h1) return { el: h1, where: "beforeend" };
    return null;
  }

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "className") node.className = v;
      else node.setAttribute(k, v);
    }
    for (const c of children) if (c != null) node.append(c);
    return node;
  }

  function buildBadge(issueUrl, result) {
    const link = `${SITE}/?q=${encodeURIComponent(issueUrl)}`;
    const wrap = el("span", { id: BADGE_ID, className: "iif-wrap", "data-iif-url": issueUrl });

    if (!result) {
      wrap.append(el("span", { className: "iif-badge iif-loading" }, "Is it free? …"));
      return wrap;
    }
    if (!result.ok) {
      wrap.append(el("span", { className: "iif-badge iif-error", title: result.error }, "Is it free? ⚠"));
      return wrap;
    }

    const data = result.data;
    const issue = data.issues && data.issues[0];
    if (!issue || data.closed) return null; // nothing useful to show on closed issues

    const v = issue.verdict;
    const s = STATUS[v.status];
    const badge = el(
      "a",
      { className: `iif-badge iif-${v.status}`, href: link, target: "_blank", rel: "noopener", "aria-describedby": "iif-card" },
      `${s.emoji} ${s.label}`,
    );

    const card = el("span", { className: "iif-card", id: "iif-card", role: "tooltip" });
    card.append(el("strong", {}, `${s.emoji} ${s.label}`));
    card.append(el("span", { className: "iif-reason" }, v.reason));
    if (v.details.length) {
      const ul = el("ul");
      v.details.forEach((d) => ul.append(el("li", {}, d)));
      card.append(ul);
    }
    if (data.health && data.health.medianResponseDays !== null) {
      card.append(el("span", { className: "iif-health" }, `💬 ${data.health.summary}`));
    }
    card.append(el("span", { className: "iif-foot" }, "Is it free? · heuristics, not magic"));

    wrap.append(badge, card);
    return wrap;
  }

  function render() {
    const issueUrl = issueUrlFromLocation();
    const existing = document.getElementById(BADGE_ID);
    if (!issueUrl) {
      existing?.remove();
      return;
    }
    // Already showing the right thing?
    if (existing && existing.dataset.iifUrl === issueUrl && issueUrl === currentUrl) {
      const fresh = lastResult ? !existing.querySelector(".iif-loading") : true;
      if (fresh) return;
    }
    const anchor = findAnchor();
    if (!anchor) return; // page not rendered yet; the observer will call us again
    existing?.remove();
    const badge = buildBadge(issueUrl, issueUrl === currentUrl ? lastResult : null);
    if (badge) anchor.el.insertAdjacentElement(anchor.where, badge);
  }

  function load() {
    const issueUrl = issueUrlFromLocation();
    if (!issueUrl || issueUrl === currentUrl) return render();
    currentUrl = issueUrl;
    lastResult = null;
    render();
    chrome.runtime.sendMessage({ type: "check", url: issueUrl }, (result) => {
      if (chrome.runtime.lastError) result = { ok: false, error: chrome.runtime.lastError.message };
      if (issueUrl !== currentUrl) return; // user navigated away meanwhile
      lastResult = result;
      document.getElementById(BADGE_ID)?.remove();
      render();
    });
  }

  // GitHub navigates without full page loads, and React re-renders can drop
  // our node, so watch the DOM (throttled) and re-check.
  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      load();
    });
  }).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("turbo:load", load);
  window.addEventListener("popstate", load);
  load();
})();
