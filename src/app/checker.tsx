"use client";

import { useMemo, useState } from "react";
import type { CheckResponse } from "@/lib/check";
import type { IssueResult, Status } from "@/lib/classify";

const EXAMPLES = ["python/cpython", "rust-lang/rust", "microsoft/vscode", "vercel/next.js"];

const STATUS: Record<Status, { label: string; dot: string; chip: string }> = {
  free: { label: "Free", dot: "bg-emerald-500", chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/30" },
  stale: { label: "Stale claim", dot: "bg-amber-500", chip: "bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/30" },
  taken: { label: "Taken", dot: "bg-rose-500", chip: "bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-rose-500/30" },
};

export default function Checker({
  initialQuery,
  initialData,
  initialError,
  pending = false,
}: {
  initialQuery: string;
  initialData: CheckResponse | null;
  initialError: string | null;
  /** Server is still loading a shared link. */
  pending?: boolean;
}) {
  const [input, setInput] = useState(initialQuery);
  const [data, setData] = useState<CheckResponse | null>(initialData);
  const [error, setError] = useState<string | null>(initialError);
  const [loading, setLoading] = useState(pending);
  const [filter, setFilter] = useState<Status | "all">("all");

  const run = async (raw: string) => {
    const q = raw.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    setData(null);
    setFilter("all");
    // Keep the URL shareable: /?q=owner/repo
    window.history.replaceState(null, "", `?q=${encodeURIComponent(q)}`);
    try {
      const res = await fetch(`/api/check?q=${encodeURIComponent(q)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Request failed");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const counts = useMemo(() => {
    const c = { free: 0, stale: 0, taken: 0 };
    data?.issues.forEach((i) => c[i.verdict.status]++);
    return c;
  }, [data]);

  const order: Record<Status, number> = { free: 0, stale: 1, taken: 2 };
  const shown = (data?.issues ?? [])
    .filter((i) => filter === "all" || i.verdict.status === filter)
    .sort((a, b) => order[a.verdict.status] - order[b.verdict.status]);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12 sm:py-20">
      <header className="mb-10 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Is it <span className="text-emerald-500">free</span>?
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-balance text-neutral-600 dark:text-neutral-400">
          Check whether a <em>good first issue</em> is actually available before you spend an hour on it.
          We read the comments, assignees and linked PRs for you.
        </p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(input);
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="owner/repo or https://github.com/owner/repo/issues/123"
          className="flex-1 rounded-xl border border-neutral-300 bg-white px-4 py-3 outline-none ring-emerald-500/40 focus:ring-4 dark:border-neutral-700 dark:bg-neutral-900"
          aria-label="Repository or issue URL"
        />
        <button
          disabled={loading || !input.trim()}
          className="rounded-xl bg-emerald-600 px-6 py-3 font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
        >
          {loading ? "Checking…" : "Check"}
        </button>
      </form>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-neutral-500">
        <span>Try:</span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            onClick={() => {
              setInput(ex);
              run(ex);
            }}
            className="rounded-full border border-neutral-300 px-3 py-1 hover:border-emerald-500 hover:text-emerald-600 dark:border-neutral-700"
          >
            {ex}
          </button>
        ))}
      </div>

      {error && (
        <p className="mt-8 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-rose-700 dark:text-rose-300">{error}</p>
      )}

      {loading && (
        <p className="mt-8 text-sm text-neutral-500" role="status">
          Reading comments, linked PRs and assignments… big repos can take ~10 seconds.
        </p>
      )}
      {loading && (
        <div className="mt-4 space-y-3" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-800" />
          ))}
        </div>
      )}

      {data && (
        <section className="mt-10">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <a href={data.repo.url} target="_blank" rel="noreferrer" className="text-xl font-semibold hover:underline">
              {data.repo.nameWithOwner}
            </a>
            <span className="text-sm text-neutral-500">
              ★ {data.repo.stars.toLocaleString()}
              {data.repo.language && ` · ${data.repo.language}`}
            </span>
          </div>
          <p className="mb-6 text-sm text-neutral-600 dark:text-neutral-400">💬 {data.health.summary}</p>

          {data.closed && (
            <p className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm">This issue is already closed.</p>
          )}

          {data.mode === "repo" && data.labels.length === 0 && (
            <p className="rounded-xl border border-neutral-300 p-4 text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
              This repo has no beginner label (like &ldquo;good first issue&rdquo;). Try pasting a specific issue URL instead.
            </p>
          )}

          {data.mode === "repo" && data.labels.length > 0 && (
            <>
              <div className="mb-4 flex flex-wrap gap-2">
                <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
                  All {data.issues.length}
                </FilterChip>
                {(Object.keys(STATUS) as Status[]).map((s) => (
                  <FilterChip key={s} active={filter === s} onClick={() => setFilter(s)}>
                    <span className={`inline-block h-2 w-2 rounded-full ${STATUS[s].dot}`} /> {STATUS[s].label} {counts[s]}
                  </FilterChip>
                ))}
              </div>
              <p className="mb-4 text-xs text-neutral-500">
                Labels: {data.labels.join(", ")}
                {data.totalOpen > data.issues.length && ` · showing newest ${data.issues.length} of ${data.totalOpen}`}
              </p>
              {data.issues.length === 0 && <p className="text-neutral-500">No open issues with those labels right now.</p>}
            </>
          )}

          <ul className="space-y-3">
            {shown.map((issue) => (
              <IssueCard key={issue.number} issue={issue} />
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-20 text-center text-xs text-neutral-500">
        Heuristics, not magic. When in doubt, ask in the issue before starting.
      </footer>
    </main>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-sm ring-1 transition ${
        active
          ? "bg-neutral-900 text-white ring-neutral-900 dark:bg-white dark:text-neutral-900 dark:ring-white"
          : "ring-neutral-300 hover:ring-neutral-500 dark:ring-neutral-700"
      }`}
    >
      {children}
    </button>
  );
}

function IssueCard({ issue }: { issue: IssueResult }) {
  const s = STATUS[issue.verdict.status];
  return (
    <li className="rounded-xl border border-neutral-200 p-4 transition hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600">
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${s.chip}`}>{s.label}</span>
        <div className="min-w-0 flex-1">
          <a href={issue.url} target="_blank" rel="noreferrer" className="font-medium break-words hover:underline">
            {issue.title} <span className="text-neutral-500">#{issue.number}</span>
          </a>
          <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">{issue.verdict.reason}</p>
          {issue.verdict.details.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-xs text-neutral-500">
              {issue.verdict.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-neutral-500">
            {issue.comments} comment{issue.comments === 1 ? "" : "s"} · opened {new Date(issue.createdAt).toLocaleDateString()}
            {issue.verdict.linkedPRs.length > 0 &&
              ` · PRs: ${issue.verdict.linkedPRs.map((p) => `#${p.number} (${p.state.toLowerCase()})`).join(", ")}`}
          </p>
        </div>
      </div>
    </li>
  );
}
