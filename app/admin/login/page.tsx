import { redirect } from "next/navigation";

import { AdminLoginForm } from "@/components/admin-login-form";
import { getAdmin } from "@/lib/auth/admin";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage({
  searchParams,
}: PageProps<"/admin/login">) {
  if (await getAdmin()) redirect("/admin");

  const { next } = await searchParams;
  // Only accept a same-site path, so `?next=https://evil.example` cannot turn the
  // login page into an open redirect.
  const target =
    typeof next === "string" && /^\/admin(\/|$)/.test(next) ? next : "/admin";

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 px-5 py-12">
      <header className="flex flex-col gap-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Organiser sign-in</h1>
        <p className="text-sm text-muted">
          Judges don&apos;t sign in here — they use their access code on the home page.
        </p>
      </header>

      <AdminLoginForm next={target} />
    </main>
  );
}
