import { redirect } from "next/navigation";

import { AssignmentList } from "@/components/assignment-list";
import { getJudgeSession } from "@/lib/auth/judge-session";
import { getAssignmentRows } from "@/lib/data/judge";

// The list changes as the judge submits; never serve it from a static shell.
export const dynamic = "force-dynamic";

export default async function JudgeHomePage() {
  const session = await getJudgeSession();
  if (!session) redirect("/");

  const rows = await getAssignmentRows(session.judgeId);

  return <AssignmentList rows={rows} />;
}
