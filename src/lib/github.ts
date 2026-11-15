// Thin GitHub GraphQL client. One request per repo pulls every issue with its
// comments, assignees and linked PRs, so we stay far under rate limits.

export type Association =
  | "OWNER"
  | "MEMBER"
  | "COLLABORATOR"
  | "CONTRIBUTOR"
  | "FIRST_TIME_CONTRIBUTOR"
  | "FIRST_TIMER"
  | "NONE"
  | "MANNEQUIN";

export interface RawComment {
  author: { login: string } | null;
  /** Empty until hydrateBodies() fills it in. */
  body?: string;
  createdAt: string;
  authorAssociation: Association;
}

export interface RawPR {
  __typename: "PullRequest";
  number: number;
  url: string;
  title: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  author: { login: string } | null;
  createdAt: string;
  updatedAt: string;
}

export type RawTimelineItem =
  | { __typename: "CrossReferencedEvent"; createdAt: string; willCloseTarget: boolean; source: RawPR | { __typename: string } }
  | { __typename: "ConnectedEvent"; createdAt: string; subject: RawPR | { __typename: string } }
  | { __typename: "AssignedEvent"; createdAt: string; assignee: { login?: string } | null };

export interface RawIssue {
  number: number;
  title: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  author: { login: string } | null;
  authorAssociation: Association;
  assignees: { nodes: { login: string }[] };
  labels: { nodes: { name: string; color: string }[] };
  comments: { totalCount: number; nodes: RawComment[] };
  timelineItems: { nodes: RawTimelineItem[] };
}

export interface RawRepo {
  nameWithOwner: string;
  url: string;
  stargazerCount: number;
  description: string | null;
  primaryLanguage: { name: string } | null;
}

const ISSUE_META = `
  number title url createdAt updatedAt authorAssociation
  author { login }
  assignees(first: 5) { nodes { login } }
  labels(first: 10) { nodes { name color } }
  # Comment bodies are very slow over GraphQL, so they're fetched via REST later (see hydrateBodies).
  comments(first: 100) { totalCount nodes { author { login } createdAt authorAssociation } }
`;

const ISSUE_TIMELINE = `
  timelineItems(last: 30, itemTypes: [CROSS_REFERENCED_EVENT, CONNECTED_EVENT, ASSIGNED_EVENT]) {
    nodes {
      __typename
      ... on CrossReferencedEvent { createdAt willCloseTarget source { __typename ...PR } }
      ... on ConnectedEvent { createdAt subject { __typename ...PR } }
      ... on AssignedEvent { createdAt assignee { ... on User { login } } }
    }
  }
`;

const ISSUE_FIELDS = ISSUE_META + ISSUE_TIMELINE;

const PR_FRAGMENT = `
  fragment PR on PullRequest {
    number url title state isDraft createdAt updatedAt author { login }
  }
`;

const REPO_FIELDS = `nameWithOwner url stargazerCount description primaryLanguage { name }`;

// Labels people use for beginner-friendly issues, in many spellings.
export const BEGINNER_LABEL =
  /good[\s_:-]*(first|for[\s_-]*(beginners?|newcomers?|first))|first[\s_-]*timers?|beginner|newcomer[\s_-]*friendly|^(e-|difficulty[:\s-]*)?(easy|starter)$|easy[\s_-]*(fix|pick)|starter[\s_-]*(task|issue)|low[\s_-]*hanging|junior[\s_-]*job|up[\s_-]*for[\s_-]*grabs|first[\s_-]*contribution/i;

// Labels that mean someone already has it, e.g. "good first issue (taken)".
export const TAKEN_LABEL = /taken|claimed|in[\s_-]*progress|being[\s_-]*worked|has[\s_-]*pr|assigned/i;

export const isBeginnerLabel = (name: string) => BEGINNER_LABEL.test(name) && !TAKEN_LABEL.test(name);

export class GitHubError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

function authHeaders() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new GitHubError("Server is missing GITHUB_TOKEN. Add it to .env.local (see README).", 500);
  }
  return { Authorization: `bearer ${token}`, "User-Agent": "is-it-free" };
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  if (res.status === 401) throw new GitHubError("GitHub rejected the token (401).", 500);
  if (!res.ok) throw new GitHubError(`GitHub API error ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: { message: string; type?: string }[] };
  if (json.errors?.length) {
    const notFound = json.errors.find((e) => e.type === "NOT_FOUND");
    if (notFound) throw new GitHubError("Repository or issue not found (or it's private).", 404);
    if (json.errors.some((e) => e.type === "RATE_LIMITED")) {
      throw new GitHubError("GitHub rate limit hit. Try again in a bit.", 429);
    }
    throw new GitHubError(json.errors[0].message);
  }
  return json.data as T;
}

// Label sets rarely change, so remember them for a day.
const labelCache = new Map<string, { at: number; labels: string[] }>();
const LABEL_TTL_MS = 24 * 60 * 60 * 1000;

/** Find which labels in this repo mean "good for beginners". */
async function findBeginnerLabels(owner: string, name: string): Promise<string[]> {
  const key = `${owner}/${name}`.toLowerCase();
  const hit = labelCache.get(key);
  if (hit && Date.now() - hit.at < LABEL_TTL_MS) return hit.labels;
  // Big repos have hundreds of labels, so search by keyword instead of paging.
  const keywords = ["first", "beginner", "easy", "starter", "newcomer", "hanging", "junior", "grabs"];
  const fields = keywords
    .map((k, i) => `k${i}: labels(first: 30, query: "${k}") { nodes { name } }`)
    .join(" ");
  const data = await gql<{ repository: Record<string, { nodes: { name: string }[] }> }>(
    `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`,
    { owner, name },
  );
  const names = keywords.flatMap((_, i) => data.repository[`k${i}`].nodes.map((l) => l.name));
  const labels = [...new Set(names)].filter(isBeginnerLabel);
  labelCache.set(key, { at: Date.now(), labels });
  return labels;
}

/**
 * Fetch the newest open beginner issues with comments, PR links and assignment
 * history. `needsBodies` decides which issues also get comment text (via REST).
 */
export async function fetchRepoIssues(
  owner: string,
  name: string,
  needsBodies: (issue: Omit<RawIssue, "timelineItems">) => boolean,
  limit = 30,
) {
  const labels = await findBeginnerLabels(owner, name);
  const vars = { owner, name, labels, limit };
  const list = (fields: string, extra = "") => `
    query($owner: String!, $name: String!, $labels: [String!], $limit: Int!) {
      repository(owner: $owner, name: $name) {
        ${extra}
        issues(first: $limit, states: OPEN, labels: $labels, orderBy: { field: CREATED_AT, direction: DESC }) {
          totalCount
          nodes { ${fields} }
        }
      }
    }`;
  type ListResult<T> = { repository: RawRepo & { issues: { totalCount: number; nodes: T[] } } };

  if (labels.length === 0) {
    const data = await gql<{ repository: RawRepo }>(
      `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${REPO_FIELDS} } }`,
      { owner, name },
    );
    return { repo: data.repository, labels, issues: [] as RawIssue[], total: 0 };
  }

  // Comments and timelines are each slow, so they run as parallel queries.
  // Comment text (REST) starts as soon as the comment list arrives.
  const metaWithBodies = gql<ListResult<Omit<RawIssue, "timelineItems">>>(list(ISSUE_META, REPO_FIELDS), vars).then(
    async (meta) => {
      await hydrateBodies(owner, name, meta.repository.issues.nodes.filter(needsBodies));
      return meta;
    },
  );
  const timelines = gql<ListResult<Pick<RawIssue, "number" | "timelineItems">>>(
    list(`number ${ISSUE_TIMELINE}`) + PR_FRAGMENT,
    vars,
  );
  const [meta, tl] = await Promise.all([metaWithBodies, timelines]);

  const byNumber = new Map(tl.repository.issues.nodes.map((n) => [n.number, n.timelineItems]));
  const { issues: list_, ...repo } = meta.repository;
  const issues: RawIssue[] = list_.nodes.map((i) => ({ ...i, timelineItems: byNumber.get(i.number) ?? { nodes: [] } }));
  return { repo, labels, issues, total: list_.totalCount };
}

export async function fetchSingleIssue(owner: string, name: string, number: number) {
  const data = await gql<{ repository: RawRepo & { issue: (RawIssue & { state: string }) | null } }>(
    `query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        ${REPO_FIELDS}
        issue(number: $number) { state ${ISSUE_FIELDS} }
      }
    }
    ${PR_FRAGMENT}`,
    { owner, name, number },
  );
  const { issue, ...repo } = data.repository;
  if (!issue) throw new GitHubError(`Issue #${number} not found (it may be a pull request).`, 404);
  return { repo, issue };
}

interface RestComment {
  user: { login: string } | null;
  body: string | null;
  created_at: string;
  author_association: Association;
}

/**
 * Fill in comment bodies via REST (fast) for the issues that need them.
 * GraphQL takes ~10x longer when asked for comment bodies.
 */
export async function hydrateBodies(owner: string, name: string, issues: Pick<RawIssue, "number" | "comments">[], concurrency = 10) {
  const queue = [...issues];
  const worker = async () => {
    for (let issue = queue.shift(); issue; issue = queue.shift()) {
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${name}/issues/${issue.number}/comments?per_page=100`,
        { headers: { ...authHeaders(), Accept: "application/vnd.github+json" }, cache: "no-store" },
      );
      if (!res.ok) continue; // Keep body-less comments; classification degrades gracefully.
      const comments = (await res.json()) as RestComment[];
      issue.comments.nodes = comments.map((c) => ({
        author: c.user ? { login: c.user.login } : null,
        body: c.body ?? "",
        createdAt: c.created_at,
        authorAssociation: c.author_association,
      }));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, issues.length) }, worker));
}
