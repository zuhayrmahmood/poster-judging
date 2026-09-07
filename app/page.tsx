import { redirect } from "next/navigation";

import { SignInForm } from "@/components/sign-in-form";
import { getLiveJudgeSession } from "@/lib/data/judge";

export default async function SignInPage() {
  // A judge stays signed in all day; don't make them re-enter the code on every visit.
  // Checked against the database, not just the cookie: a judge deleted or deactivated
  // mid-event still holds a verifying token, and sending them to /judge on the strength
  // of it alone would bounce them straight back here.
  if (await getLiveJudgeSession()) redirect("/judge");

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 px-5 py-12">
      <header className="flex flex-col gap-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Poster Judging</h1>
        <p className="text-sm text-muted">
          Enter the code from your judge card to see the posters assigned to you.
        </p>
      </header>

      <SignInForm />

      <p className="text-center text-xs text-muted">
        Lost your code? Ask an organiser — they can issue a new one.
      </p>
    </main>
  );
}
