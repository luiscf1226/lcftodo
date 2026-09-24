import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { ONBOARDING_PATH } from "@/lib/routes";

const isApp = createRouteMatcher(["/app(.*)"]);
const isOnboarding = createRouteMatcher([`${ONBOARDING_PATH}(.*)`]);
const isHome = createRouteMatcher(["/"]);

// The Clerk instance requires organization membership, so a signed-in user with no team has a
// *pending* session (Clerk's `choose-organization` session task). Clerk treats pending sessions as
// signed out by default (`treatPendingAsSignedOut`), which is what we want for /app: Convex auth and
// every query need an active team. Instead of bouncing pending users to /sign-in, send them to our
// onboarding page, which hosts <TaskChooseOrganization /> (wired up via ClerkProvider `taskUrls`).
export default clerkMiddleware(async (auth, req) => {
  if (!isApp(req) && !isOnboarding(req) && !isHome(req)) return;

  const { sessionStatus } = await auth({ treatPendingAsSignedOut: false });
  if (sessionStatus === "pending") {
    return isOnboarding(req) ? undefined : NextResponse.redirect(new URL(ONBOARDING_PATH, req.url));
  }

  // Signed-out visitors of /app or /onboarding go to sign-in and come back afterwards.
  if (!isHome(req)) await auth.protect();
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
