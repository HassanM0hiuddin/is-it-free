import { describe, expect, it } from "vitest";
import { classify, looksLikeClaim, repoHealth } from "../classify";
import { isBeginnerLabel, type RawComment, type RawIssue, type RawPR } from "../github";

const NOW = new Date("2026-11-15T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

function issue(over: Partial<RawIssue> = {}): RawIssue {
  return {
    number: 1,
    title: "Fix typo",
    url: "https://github.com/acme/app/issues/1",
    createdAt: daysAgo(60),
    updatedAt: daysAgo(1),
    author: { login: "maint" },
    authorAssociation: "MEMBER",
    assignees: { nodes: [] },
    labels: { nodes: [{ name: "good first issue", color: "7057ff" }] },
    comments: { totalCount: 0, nodes: [] },
    timelineItems: { nodes: [] },
    ...over,
  };
}

const comment = (login: string, body: string, d: number, assoc: RawComment["authorAssociation"] = "NONE"): RawComment => ({
  author: { login },
  body,
  createdAt: daysAgo(d),
  authorAssociation: assoc,
});

const withComments = (...nodes: RawComment[]) => ({ comments: { totalCount: nodes.length, nodes } });

const pr = (over: Partial<RawPR> = {}): RawPR => ({
  __typename: "PullRequest",
  number: 99,
  url: "https://github.com/acme/app/pull/99",
  title: "Fix",
  state: "OPEN",
  isDraft: false,
  author: { login: "dev" },
  createdAt: daysAgo(3),
  updatedAt: daysAgo(2),
  ...over,
});

const crossRef = (p: RawPR) => ({ __typename: "CrossReferencedEvent" as const, createdAt: p.createdAt, willCloseTarget: true, source: p });

describe("classify", () => {
  it("is free when nobody has touched it", () => {
    expect(classify(issue(), NOW).status).toBe("free");
  });

  it("is taken when someone recently asked to work on it", () => {
    const v = classify(issue(withComments(comment("alice", "Hi! Can I work on this?", 2))), NOW);
    expect(v.status).toBe("taken");
    expect(v.reason).toContain("@alice");
  });

  it("is stale when the claimant went quiet", () => {
    const v = classify(issue(withComments(comment("alice", "I'd like to work on this", 40))), NOW);
    expect(v.status).toBe("stale");
  });

  it("treats a later comment from the claimant as activity", () => {
    const v = classify(
      issue(withComments(comment("alice", "Can I take this?", 40), comment("alice", "Still on it, PR soon", 3))),
      NOW,
    );
    expect(v.status).toBe("taken");
  });

  it("frees the issue when the claimant backs out", () => {
    const v = classify(
      issue(withComments(comment("alice", "Can I take this?", 10), comment("alice", "Sorry, I can't continue, feel free to take it", 5))),
      NOW,
    );
    expect(v.status).toBe("free");
  });

  it("ignores maintainer comments that sound like claims", () => {
    const v = classify(issue(withComments(comment("maint", "I'll take a look at this", 1, "MEMBER"))), NOW);
    expect(v.status).toBe("free");
  });

  it("is taken when there is an active open PR", () => {
    const v = classify(issue({ timelineItems: { nodes: [crossRef(pr())] } }), NOW);
    expect(v.status).toBe("taken");
    expect(v.reason).toContain("#99");
  });

  it("is stale when the only open PR is abandoned", () => {
    const old = pr({ updatedAt: daysAgo(90), createdAt: daysAgo(100) });
    expect(classify(issue({ timelineItems: { nodes: [crossRef(old)] } }), NOW).status).toBe("stale");
  });

  it("flags merged PRs as probably fixed", () => {
    const v = classify(issue({ timelineItems: { nodes: [crossRef(pr({ state: "MERGED" }))] } }), NOW);
    expect(v.status).toBe("taken");
    expect(v.reason).toMatch(/merged/);
  });

  it("ignores PRs from other repos that merely mention the issue", () => {
    const foreign = pr({ url: "https://github.com/someone/fork/pull/5" });
    expect(classify(issue({ timelineItems: { nodes: [crossRef(foreign)] } }), NOW).status).toBe("free");
  });

  it("warns when a free issue is an old, long discussion", () => {
    const many = Array.from({ length: 20 }, (_, i) => comment("m" + i, "thoughts on the API design", 500 - i, "MEMBER"));
    const v = classify(issue({ createdAt: daysAgo(900), ...withComments(...many) }), NOW);
    expect(v.status).toBe("free");
    expect(v.details.join(" ")).toMatch(/harder than the label/);
  });

  it("respects a 'taken' label", () => {
    const v = classify(issue({ labels: { nodes: [{ name: "good first issue (taken)", color: "000" }] } }), NOW);
    expect(v.status).toBe("taken");
  });

  it("does not treat a maintainer assignee as a claim", () => {
    const v = classify(
      issue({ assignees: { nodes: [{ login: "maint" }] }, ...withComments(comment("maint", "Good first issue!", 30, "MEMBER")) }),
      NOW,
    );
    expect(v.status).toBe("free");
  });

  it("treats an outside assignee as taken", () => {
    const v = classify(
      issue({
        assignees: { nodes: [{ login: "bob" }] },
        timelineItems: { nodes: [{ __typename: "AssignedEvent", createdAt: daysAgo(3), assignee: { login: "bob" } }] },
      }),
      NOW,
    );
    expect(v.status).toBe("taken");
    expect(v.reason).toContain("assigned");
  });
});

describe("looksLikeClaim", () => {
  it.each([
    "Can I work on this?",
    "Hi, could I please take this issue?",
    "Please assign this to me",
    "assign me",
    "I'd like to work on this",
    "I would love to contribute to this one",
    "I'm working on it",
    "/assign",
    "Picking this up!",
    "Hi folks, I'd be interested in contributing to this issue",
  ])("detects %j", (text) => expect(looksLikeClaim(text)).toBe(true));

  it.each([
    "This is still broken on 3.12",
    "Thanks for the report",
    "> can I work on this?\nNo, already assigned",
    "Is anyone working on this?",
  ])("ignores %j", (text) => expect(looksLikeClaim(text)).toBe(false));
});

describe("isBeginnerLabel", () => {
  it.each(["good first issue", "Good First Issue", "good-first-issue", "E-easy", "Difficulty: starter", "first-timers-only", "junior job", "up-for-grabs"])(
    "accepts %j",
    (l) => expect(isBeginnerLabel(l)).toBe(true),
  );
  it.each(["good first issue (taken)", "D-newcomer-roadblock", "help wanted", "combine/combine_first/update", "E-mentor"])(
    "rejects %j",
    (l) => expect(isBeginnerLabel(l)).toBe(false),
  );
});

describe("repoHealth", () => {
  it("reports median maintainer reply time", () => {
    const mk = (n: number, reply: number) =>
      issue({
        number: n,
        author: { login: "u" + n },
        authorAssociation: "NONE",
        createdAt: daysAgo(30),
        ...withComments(comment("maint", "thanks", 30 - reply, "MEMBER")),
      });
    expect(repoHealth([mk(1, 1), mk(2, 3), mk(3, 5)]).medianResponseDays).toBe(3);
  });

  it("refuses to guess from too little data", () => {
    expect(repoHealth([issue()]).medianResponseDays).toBeNull();
  });
});
