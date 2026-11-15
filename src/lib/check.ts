import { fetchRepoIssues, fetchSingleIssue, GitHubError, hydrateBodies } from "./github";
import { knownMaintainers, needsCommentBodies, repoHealth, toResult, type IssueResult, type RepoHealth } from "./classify";
import { parseTarget } from "./parse";

export interface CheckResponse {
  repo: { nameWithOwner: string; url: string; stars: number; description: string | null; language: string | null };
  labels: string[];
  totalOpen: number;
  issues: IssueResult[];
  health: RepoHealth;
  mode: "repo" | "issue";
  closed?: boolean;
}

export type CheckOutcome = { ok: true; data: CheckResponse } | { ok: false; error: string; status: number };

// Small in-memory cache so repeated lookups don't burn API quota.
const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; data: CheckResponse }>();

export async function check(q: string): Promise<CheckOutcome> {
  const target = parseTarget(q);
  if (!target) {
    return { ok: false, status: 400, error: "Enter a repo like facebook/react or a GitHub issue URL." };
  }

  const key = JSON.stringify(target).toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return { ok: true, data: hit.data };

  try {
    let data: CheckResponse;
    if (target.kind === "issue") {
      const { repo, issue } = await fetchSingleIssue(target.owner, target.name, target.number);
      await hydrateBodies(target.owner, target.name, [issue]);
      data = {
        repo: shapeRepo(repo),
        labels: issue.labels.nodes.map((l) => l.name),
        totalOpen: 1,
        issues: [toResult(issue)],
        health: repoHealth([issue]),
        mode: "issue",
        closed: issue.state !== "OPEN",
      };
    } else {
      const { repo, labels, issues, total } = await fetchRepoIssues(target.owner, target.name, needsCommentBodies);
      const maintainers = knownMaintainers(issues);
      data = {
        repo: shapeRepo(repo),
        labels,
        totalOpen: total,
        issues: issues.map((i) => toResult(i, maintainers)),
        health: repoHealth(issues),
        mode: "repo",
      };
    }
    cache.set(key, { at: Date.now(), data });
    return { ok: true, data };
  } catch (e) {
    if (e instanceof GitHubError) return { ok: false, status: e.status, error: e.message };
    console.error(e);
    return { ok: false, status: 500, error: "Something went wrong talking to GitHub." };
  }
}

function shapeRepo(r: { nameWithOwner: string; url: string; stargazerCount: number; description: string | null; primaryLanguage: { name: string } | null }) {
  return { nameWithOwner: r.nameWithOwner, url: r.url, stars: r.stargazerCount, description: r.description, language: r.primaryLanguage?.name ?? null };
}
