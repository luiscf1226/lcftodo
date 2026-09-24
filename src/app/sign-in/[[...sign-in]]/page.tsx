import { SignIn } from "@clerk/nextjs";

export default function Page() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <SignIn forceRedirectUrl="/app" signUpUrl="/sign-up" />
    </main>
  );
}
