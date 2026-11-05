// LOCAL ONLY: the oracle's mock HCS log, oracle/.hcs-mock/<topic>.jsonl (one JSON line per message, ARCHITECTURE §6.5).
import path from "node:path";
import { connection, type NextRequest } from "next/server";
import { ORACLE_DIR, SAFE_ID, localApiDisabled, localApiEnabled, readText } from "@/lib/server/repo";

type MockLine = { topicId: string; sequenceNumber: number; consensusTimestamp: string; message: string };

export async function GET(request: NextRequest) {
  // Request time only: otherwise a build without FAULTLINE_LOCAL_API would prerender the "disabled" answer.
  await connection();
  if (!localApiEnabled()) return localApiDisabled();
  const topic = request.nextUrl.searchParams.get("topic") ?? "";
  if (!SAFE_ID.test(topic)) return Response.json({ error: "Invalid topic id." }, { status: 400 });
  const text = await readText(path.join(ORACLE_DIR, ".hcs-mock", `${topic}.jsonl`));
  const lines: MockLine[] = [];
  for (const row of (text ?? "").split("\n")) {
    if (!row.trim()) continue;
    try {
      const l = JSON.parse(row) as MockLine;
      if (typeof l.sequenceNumber === "number" && typeof l.message === "string") lines.push({ topicId: l.topicId, sequenceNumber: l.sequenceNumber, consensusTimestamp: String(l.consensusTimestamp), message: l.message });
    } catch {
      /* a line being written right now; the next poll reads it */
    }
  }
  return Response.json({ topic, lines });
}
