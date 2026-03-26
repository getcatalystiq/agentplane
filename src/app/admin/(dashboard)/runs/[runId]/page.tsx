import { notFound } from "next/navigation";
import { z } from "zod";
import { queryOne } from "@/db";
import { RunRow } from "@/lib/validation";
import { LiveRunDetail } from "./live-run-detail";

export const dynamic = "force-dynamic";

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;

  const run = await queryOne(RunRow, "SELECT * FROM runs WHERE id = $1", [runId]);
  if (!run) notFound();

  const agentModel = await queryOne(
    z.object({ model: z.string() }),
    "SELECT model FROM agents WHERE id = $1",
    [run.agent_id],
  );

  // For A2A runs, resolve the requesting API key name
  let requestedByKeyName: string | null = null;
  if (run.triggered_by === "a2a" && run.created_by_key_id) {
    const keyRow = await queryOne(
      z.object({ name: z.string() }),
      "SELECT name FROM api_keys WHERE id = $1",
      [run.created_by_key_id],
    );
    requestedByKeyName = keyRow?.name ?? null;
  }

  // Fetch transcript
  let transcript: { type: string; [key: string]: unknown }[] = [];
  if (run.transcript_blob_url) {
    try {
      const res = await fetch(run.transcript_blob_url);
      if (res.ok) {
        const text = await res.text();
        transcript = text
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            try {
              return JSON.parse(line);
            } catch {
              return { type: "raw", data: line };
            }
          });
      }
    } catch {
      // ok
    }
  }

  return (
    <LiveRunDetail
      run={run}
      transcript={transcript}
      agentModel={agentModel?.model ?? null}
      requestedByKeyName={requestedByKeyName}
    />
  );
}
