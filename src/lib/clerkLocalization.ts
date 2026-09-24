import type { ClerkProvider } from "@clerk/nextjs";
import type { ComponentProps } from "react";

// Clerk calls teams "organizations"; the app calls them teams. Only the onboarding task is
// overridden here, everything else keeps Clerk's default English strings.
export const clerkLocalization: ComponentProps<typeof ClerkProvider>["localization"] = {
  taskChooseOrganization: {
    title: "Set up your team",
    subtitle: "Create a team for your crew, or join one you've been invited to",
    createOrganization: {
      title: "Create your team",
      subtitle: "Name your team. You can invite teammates next",
      formButtonSubmit: "Create team",
      formFieldLabel__name: "Team name",
      formFieldInputPlaceholder__name: "e.g. Design crew",
    },
    chooseOrganization: {
      title: "Choose a team",
      subtitle: "Join a team you've been invited to, or create a new one",
      subtitle__createOrganizationDisabled: "Join a team you've been invited to",
      action__createOrganization: "Create a new team",
    },
    organizationCreationDisabled: {
      title: "You need an invite",
      subtitle: "Ask a teammate to invite you to their team",
    },
  },
};
