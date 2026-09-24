import { SignUp } from "@clerk/nextjs";

export default function Page() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <SignUp forceRedirectUrl="/app" signInUrl="/sign-in" />
    </main>
  );
}
