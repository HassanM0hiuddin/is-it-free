export type Target =
  | { kind: "repo"; owner: string; name: string }
  | { kind: "issue"; owner: string; name: string; number: number };

const NAME = /^[A-Za-z0-9_.-]+$/;

/** Accepts "owner/repo", "github.com/owner/repo", or a full issue URL. */
export function parseTarget(input: string): Target | null {
  let s = input.trim().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
  s = s.replace(/^github\.com\//, "");
  const parts = s.split("/");
  if (parts.length < 2) return null;
  const [owner, rawName] = parts;
  const name = rawName.replace(/\.git$/, "");
  if (!NAME.test(owner) || !NAME.test(name)) return null;
  if (parts[2] === "issues" && parts[3] && /^\d+$/.test(parts[3])) {
    return { kind: "issue", owner, name, number: Number(parts[3]) };
  }
  return { kind: "repo", owner, name };
}
