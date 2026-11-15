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
    // GitHub's header clips overflowing children, so the card is position:fixed
    // and placed under the badge whenever it opens.
    const place = () => {
      const r = badge.getBoundingClientRect();
      const width = Math.min(320, window.innerWidth - 16);
      card.style.top = `${r.bottom + 6}px`;
      card.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - width - 8))}px`;
      card.style.width = `${width}px`;
    };
    wrap.addEventListener("mouseenter", place);
    wrap.addEventListener("focusin", place);
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

  // ---------------------------------------------------------------------------
  // Issue list pages: a compact badge after every issue title.
  // ---------------------------------------------------------------------------
  const ROW_CLASS = "iif-row";
  const list = { repo: null, results: new Map(), pending: new Set(), queue: new Set(), timer: null };

  /** "owner/repo" on /owner/repo/issues (any filters), otherwise null. */
  function listRepoFromLocation() {
    const m = location.pathname.match(/^\/([^/]+)\/([^/]+)\/issues\/?$/);
    return m ? `${m[1]}/${m[2]}` : null;
  }

  function rowBadge(n, result) {
    const attrs = { className: `${ROW_CLASS} iif-badge`, "data-iif-n": String(n) };
    if (result === undefined) {
      return el("span", { ...attrs, className: `${attrs.className} iif-loading iif-small`, title: "Is it free? Checking…" }, "…");
    }
    if (result.error) {
      return el("span", { ...attrs, className: `${attrs.className} iif-error iif-small`, title: `Is it free? ${result.error}` }, "⚠");
    }
    const v = result.verdict;
    const s = STATUS[v.status];
    const tip = [`${s.label}: ${v.reason}`, ...v.details.map((d) => `• ${d}`)].join("\n");
    return el(
      "a",
      { ...attrs, className: `${attrs.className} iif-${v.status}`, title: tip, href: `${SITE}/?q=${encodeURIComponent(result.url)}`, target: "_blank", rel: "noopener" },
      `${s.emoji} ${s.label}`,
    );
  }

  function flushQueue() {
    list.timer = null;
    const repo = list.repo;
    const numbers = [...list.queue];
    list.queue.clear();
    if (!repo || numbers.length === 0) return;
    numbers.forEach((n) => list.pending.add(n));
    chrome.runtime.sendMessage({ type: "batch", repo, numbers }, (resp) => {
      if (chrome.runtime.lastError) resp = { ok: false, error: chrome.runtime.lastError.message, issues: {} };
      if (repo !== list.repo) return; // navigated to another repo meanwhile
      for (const n of numbers) {
        list.pending.delete(n);
        // null = not an open issue (PR, closed…): show nothing.
        list.results.set(n, resp.issues[n] || (resp.ok ? null : { error: resp.error }));
      }
      renderList();
    });
  }

  function renderList() {
    const repo = listRepoFromLocation();
    if (!repo) {
      document.querySelectorAll(`.${ROW_CLASS}`).forEach((b) => b.remove());
      return;
    }
    if (repo !== list.repo) {
      list.repo = repo;
      list.results.clear();
      list.pending.clear();
      list.queue.clear();
    }
    for (const link of document.querySelectorAll('a[data-testid="issue-listitem-title-link"]')) {
      const m = (link.getAttribute("href") || "").match(/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)|^\/([^/]+\/[^/]+)\/issues\/(\d+)/);
      if (!m) continue;
      const linkRepo = m[1] || m[3];
      const n = Number(m[2] || m[4]);
      if (linkRepo.toLowerCase() !== repo.toLowerCase()) continue;

      const host = link.closest("h3") || link;
      const existing = host.nextElementSibling?.classList.contains(ROW_CLASS) ? host.nextElementSibling : null;
      const result = list.results.get(n);

      if (result === undefined && !list.pending.has(n) && !list.queue.has(n)) {
        list.queue.add(n);
        // Collect rows rendered in the same burst into one request.
        if (!list.timer) list.timer = setTimeout(flushQueue, 150);
      }
      const want = result === null ? null : result === undefined ? "loading" : result.error ? "error" : result.verdict.status;
      const have = existing ? existing.dataset.iifState : null;
      if (want === have && existing?.dataset.iifN === String(n)) continue;
      existing?.remove();
      if (want === null) continue;
      const badge = rowBadge(n, result === undefined ? undefined : { ...result, url: `https://github.com/${repo}/issues/${n}` });
      badge.dataset.iifState = want;
      host.insertAdjacentElement("afterend", badge);
    }
  }

  // GitHub navigates without full page loads, and React re-renders can drop
  // our nodes, so watch the DOM (throttled) and re-check.
  const refresh = () => {
    load();
    renderList();
  };
  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      refresh();
    });
  }).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("turbo:load", refresh);
  window.addEventListener("popstate", refresh);
  refresh();
})();
