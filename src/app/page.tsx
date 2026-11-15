import { Suspense } from "react";
import { connection } from "next/server";
import Checker from "./checker";
import { check } from "@/lib/check";

export default function Home({ searchParams }: PageProps<"/">) {
  return (
    // The shell is static; results for shared links (/?q=owner/repo) stream in on the server.
    <Suspense fallback={<Checker initialQuery="" initialData={null} initialError={null} pending />}>
      <Results searchParams={searchParams} />
    </Suspense>
  );
}

async function Results({ searchParams }: Pick<PageProps<"/">, "searchParams">) {
  // Results depend on live GitHub data, so never prerender past this point.
  await connection();
  const { q } = await searchParams;
  const query = typeof q === "string" ? q.trim() : "";
  const initial = query ? await check(query) : null;
  return (
    <Checker
      key={query}
      initialQuery={query}
      initialData={initial?.ok ? initial.data : null}
      initialError={initial && !initial.ok ? initial.error : null}
    />
  );
}
