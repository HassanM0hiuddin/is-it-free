import { check } from "@/lib/check";

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  const result = await check(q);
  return result.ok ? Response.json(result.data) : Response.json({ error: result.error }, { status: result.status });
}
