import { check, checkBatch } from "@/lib/check";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const q = params.get("q") ?? "";
  const numbers = params.get("numbers");
  const result = numbers !== null ? await checkBatch(q, numbers) : await check(q);
  return result.ok ? Response.json(result.data) : Response.json({ error: result.error }, { status: result.status });
}
