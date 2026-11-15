import { TAKEN_LABEL, type Association, type RawIssue, type RawPR } from "./github";

export type Status = "free" | "stale" | "taken";

export interface Verdict {
  status: Status;
  /** One-line human explanation, e.g. "@alice asked to work on it 2 days ago". */
  reason: string;
  /** Extra supporting facts shown under the reason. */
  details: string[];
  claimants: string[];
  linkedPRs: { number: number; url: string; state: string; isDraft: boolean; author: string | null }[];
}

export interface IssueResult {
  number: number;
  title: string;
  url: string;
  createdAt: string;
  labels: { name: string; color: string }[];
  comments: number;
  verdict: Verdict;
}

// How long a claim or PR can sit silent before we call it abandoned.
export const CLAIM_STALE_DAYS = 14;
export const PR_STALE_DAYS = 30;

const MAINTAINER: Association[] = ["OWNER", "MEMBER", "COLLABORATOR"];
export const isMaintainer = (a: Association) => MAINTAINER.includes(a);

// Phrases contributors use to call dibs on an issue.
const CLAIM_PATTERNS = [
  /\b(can|could|may)\s+i\s+(please\s+)?(work|take|try|pick|tackle|handle|fix|attempt|grab|have|get)\b/i,
  /\b(assign|give)\s+(this|it|the issue)?\s*(issue\s+)?(to\s+)?me\b/i,
  /\bplease\s+assign\b/i,
  /\bi('?d| would)\s+(like|love|want)\s+to\s+(work|take|try|pick|tackle|fix|contribute|help|give)/i,
  /\bi\s+want\s+to\s+(work|take|try|pick|tackle|fix|contribute)/i,
  /\bi('?ll| will| can)\s+(work on|take|pick|tackle|fix|handle|look into|give it a)/i,
  /\bi('?m| am)\s+(currently\s+)?(working on|on it|taking|picking|looking into)/i,
  /\b(picking|taking)\s+(this|it)\s+up\b/i,
  /\blet\s+me\s+(work|take|try|handle|fix)/i,
  /\binterested\s+in\s+(working|taking|contributing|helping|fixing|tackling|picking|this)/i,
  /^\s*(\/assign|\.take|\/take|\/claim)\b/im,
];

// Phrases that withdraw a claim.
const UNCLAIM_PATTERNS = [
  /\b(un-?assign|unassigning)\s+(me|myself)\b/i,
  /\b(no longer|not able to|can'?t|cannot|won'?t be able to)\s+(work|continue|finish)/i,
  /\bfeel free to (take|pick|grab)/i,
  /\bit'?s (all )?yours\b/i,
];

export const looksLikeClaim = (body = "") => {
  // Ignore quoted text so replies like "> can I work on this" don't count twice.
  const text = body.split("\n").filter((l) => !l.trimStart().startsWith(">")).join("\n");
  return CLAIM_PATTERNS.some((p) => p.test(text));
};
const looksLikeUnclaim = (body = "") => UNCLAIM_PATTERNS.some((p) => p.test(body));

export function daysBetween(a: Date | string, b: Date | string) {
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

export function ago(date: string, now = new Date()) {
  const d = daysBetween(date, now);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 30) return `${d} days ago`;
  const m = Math.round(d / 30);
  if (m < 12) return `${m} month${m > 1 ? "s" : ""} ago`;
  const y = Math.round(d / 365);
  return `${y} year${y > 1 ? "s" : ""} ago`;
}

function linkedPullRequests(issue: RawIssue): RawPR[] {
  const byNumber = new Map<number, RawPR>();
  for (const item of issue.timelineItems.nodes) {
    let pr: unknown = null;
    if (item.__typename === "CrossReferencedEvent") pr = item.source;
    else if (item.__typename === "ConnectedEvent") pr = item.subject;
    if (pr && (pr as RawPR).__typename === "PullRequest") {
      const p = pr as RawPR;
      // Only same-repo PRs reliably target this issue; cross-repo refs are noise.
      if (p.url.split("/pull/")[0] === issue.url.split("/issues/")[0]) byNumber.set(p.number, p);
    }
  }
  return [...byNumber.values()];
}

/**
 * Do we need comment text? Only if someone outside the team has commented
 * (that's where claims live) and no "taken" label already settles it.
 */
export function needsCommentBodies(issue: Pick<RawIssue, "labels" | "comments">): boolean {
  if (issue.labels.nodes.some((l) => TAKEN_LABEL.test(l.name))) return false;
  return issue.comments.nodes.some((c) => !isMaintainer(c.authorAssociation) && !c.author?.login.endsWith("[bot]"));
}

/** Logins we've seen acting as maintainers anywhere in the fetched issues. */
export function knownMaintainers(issues: RawIssue[]): Set<string> {
  const set = new Set<string>();
  for (const i of issues) {
    if (i.author && isMaintainer(i.authorAssociation)) set.add(i.author.login);
    for (const c of i.comments.nodes) if (c.author && isMaintainer(c.authorAssociation)) set.add(c.author.login);
  }
  return set;
}

export function classify(issue: RawIssue, now = new Date(), maintainers = knownMaintainers([issue])): Verdict {
  const details: string[] = [];
  const prs = linkedPullRequests(issue);
  const linkedPRs = prs.map((p) => ({
    number: p.number,
    url: p.url,
    state: p.state,
    isDraft: p.isDraft,
    author: p.author?.login ?? null,
  }));

  // --- Who claimed it, and when did they last show signs of life? ---
  const lastActivity = new Map<string, string>(); // login -> latest date we saw them active
  const claims = new Map<string, string>(); // login -> first claim date
  for (const c of issue.comments.nodes) {
    const who = c.author?.login;
    if (!who || who.endsWith("[bot]")) continue;
    if (isMaintainer(c.authorAssociation)) continue;
    if (claims.has(who)) {
      if (looksLikeUnclaim(c.body)) claims.delete(who);
    } else if (looksLikeClaim(c.body)) {
      claims.set(who, c.createdAt);
    }
    lastActivity.set(who, c.createdAt);
  }
  for (const item of issue.timelineItems.nodes) {
    if (item.__typename === "AssignedEvent" && item.assignee?.login) {
      const who = item.assignee.login;
      // Staff are often assigned as area owners, not because they're coding it.
      if (maintainers.has(who)) continue;
      if (!claims.has(who)) claims.set(who, item.createdAt);
      const prev = lastActivity.get(who);
      if (!prev || prev < item.createdAt) lastActivity.set(who, item.createdAt);
    }
  }
  for (const p of prs) {
    const who = p.author?.login;
    if (!who) continue;
    const prev = lastActivity.get(who);
    if (!prev || prev < p.updatedAt) lastActivity.set(who, p.updatedAt);
  }

  const allAssignees = issue.assignees.nodes.map((a) => a.login);
  const assignees = allAssignees.filter((a) => !maintainers.has(a));
  const staffAssignees = allAssignees.filter((a) => maintainers.has(a));
  const claimants = [...new Set([...assignees, ...claims.keys()])];

  // --- 1. An open PR is the strongest signal. ---
  const openPRs = prs.filter((p) => p.state === "OPEN");
  const freshPR = openPRs
    .filter((p) => daysBetween(p.updatedAt, now) <= PR_STALE_DAYS)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (freshPR) {
    return {
      status: "taken",
      reason: `${freshPR.isDraft ? "Draft PR" : "PR"} #${freshPR.number} by @${freshPR.author?.login ?? "unknown"} is open (updated ${ago(freshPR.updatedAt, now)})`,
      details: openPRs.length > 1 ? [`${openPRs.length} open PRs reference this issue`] : [],
      claimants,
      linkedPRs,
    };
  }

  const merged = prs.find((p) => p.state === "MERGED");
  if (merged) {
    return {
      status: "taken",
      reason: `PR #${merged.number} was merged ${ago(merged.updatedAt, now)}. It's probably fixed and the issue just wasn't closed`,
      details: [],
      claimants,
      linkedPRs,
    };
  }

  // --- 2. Maintainers explicitly labelled it as taken. ---
  const takenLabel = issue.labels.nodes.find((l) => TAKEN_LABEL.test(l.name));
  if (takenLabel) {
    return { status: "taken", reason: `Labelled “${takenLabel.name}” by maintainers`, details, claimants, linkedPRs };
  }

  // --- 3. Recent claims / assignments. ---
  const active = claimants
    .map((who) => ({ who, last: lastActivity.get(who) ?? claims.get(who) ?? issue.updatedAt }))
    .filter(({ last }) => daysBetween(last, now) <= CLAIM_STALE_DAYS)
    .sort((a, b) => b.last.localeCompare(a.last));
  if (active.length > 0) {
    const top = active[0];
    const assigned = assignees.includes(top.who);
    if (active.length > 1) details.push(`${active.length} people have claimed it recently`);
    return {
      status: "taken",
      reason: `@${top.who} ${assigned ? "is assigned" : "asked to work on it"}. Last active ${ago(top.last, now)}`,
      details,
      claimants,
      linkedPRs,
    };
  }

  // --- 4. Someone claimed it once but went quiet. ---
  if (claimants.length > 0 || openPRs.length > 0) {
    const last = claimants
      .map((who) => ({ who, last: lastActivity.get(who) ?? claims.get(who)! }))
      .filter((x) => x.last)
      .sort((a, b) => b.last.localeCompare(a.last))[0];
    if (openPRs.length > 0) {
      const p = openPRs[0];
      details.push(`PR #${p.number} by @${p.author?.login ?? "unknown"} has had no activity for ${daysBetween(p.updatedAt, now)} days`);
    }
    if (last) details.push(`@${last.who} was last active ${ago(last.last, now)}`);
    if (assignees.length > 0) details.push(`Still assigned to ${assignees.map((a) => "@" + a).join(", ")}, so ask a maintainer first`);
    return {
      status: "stale",
      reason: `Claimed before, but there's been no activity for ${CLAIM_STALE_DAYS}+ days. Politely ask if you can take over`,
      details,
      claimants,
      linkedPRs,
    };
  }

  // --- 5. Nobody's on it. ---
  if (staffAssignees.length > 0) details.push(`Assigned to maintainer ${staffAssignees.map((a) => "@" + a).join(", ")} (usually just the area owner)`);
  if (prs.length > 0) details.push(`${prs.length} closed PR${prs.length > 1 ? "s" : ""} tried this before. Worth reading first`);
  const ageDays = daysBetween(issue.createdAt, now);
  if (ageDays > 365 && issue.comments.totalCount >= 15) {
    details.push(`Open for ${Math.floor(ageDays / 365)}+ years with ${issue.comments.totalCount} comments. Probably harder than the label suggests`);
  }
  return {
    status: "free",
    reason: issue.comments.totalCount === 0 ? "No comments, no PRs, nobody assigned" : "Nobody has claimed it or opened a PR",
    details,
    claimants,
    linkedPRs,
  };
}

export function toResult(issue: RawIssue, maintainers?: Set<string>, now = new Date()): IssueResult {
  return {
    number: issue.number,
    title: issue.title,
    url: issue.url,
    createdAt: issue.createdAt,
    labels: issue.labels.nodes,
    comments: issue.comments.totalCount,
    verdict: classify(issue, now, maintainers),
  };
}

export interface RepoHealth {
  /** Median days until a maintainer first replies to an outside issue/comment. */
  medianResponseDays: number | null;
  sampleSize: number;
  summary: string;
}

/** Estimate maintainer responsiveness from the issues we already fetched. */
export function repoHealth(issues: RawIssue[]): RepoHealth {
  const waits: number[] = [];
  for (const issue of issues) {
    if (isMaintainer(issue.authorAssociation)) {
      // Maintainer-filed issue: measure reply to the first outside comment instead.
      const firstOutside = issue.comments.nodes.find((c) => !isMaintainer(c.authorAssociation) && !c.author?.login.endsWith("[bot]"));
      if (!firstOutside) continue;
      const reply = issue.comments.nodes.find((c) => isMaintainer(c.authorAssociation) && c.createdAt > firstOutside.createdAt);
      if (reply) waits.push(daysBetween(firstOutside.createdAt, reply.createdAt));
    } else {
      const reply = issue.comments.nodes.find((c) => isMaintainer(c.authorAssociation));
      if (reply) waits.push(daysBetween(issue.createdAt, reply.createdAt));
    }
  }
  if (waits.length < 3) {
    return { medianResponseDays: null, sampleSize: waits.length, summary: "Not enough data to judge maintainer response time" };
  }
  waits.sort((a, b) => a - b);
  const median = waits[Math.floor(waits.length / 2)];
  const summary =
    median <= 1 ? "Maintainers usually reply within a day 🚀"
    : median <= 7 ? `Maintainers usually reply in ~${median} days`
    : median <= 30 ? `Maintainers are slow. Expect replies in ~${median} days`
    : `Maintainers rarely reply (~${median} days median)`;
  return { medianResponseDays: median, sampleSize: waits.length, summary };
}
