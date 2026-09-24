import type { ClerkProvider } from "@clerk/nextjs";
import type { ComponentProps } from "react";
import { esES } from "@clerk/localizations/es-ES";

// Clerk calls teams "organizations"; the app calls them teams.
export const clerkLocalization: ComponentProps<typeof ClerkProvider>["localization"] = {
  ...esES,
  taskChooseOrganization: {
    title: "Configura tu equipo",
    subtitle: "Crea un equipo o únete a uno al que te hayan invitado",
    createOrganization: {
      title: "Crea tu equipo",
      subtitle: "Ponle un nombre. Después podrás invitar a tus compañeros",
      formButtonSubmit: "Crear equipo",
      formFieldLabel__name: "Nombre del equipo",
      formFieldInputPlaceholder__name: "Ej.: Equipo de diseño",
    },
    chooseOrganization: {
      title: "Elige un equipo",
      subtitle: "Únete a un equipo al que te hayan invitado o crea uno nuevo",
      subtitle__createOrganizationDisabled: "Únete a un equipo al que te hayan invitado",
      action__createOrganization: "Crear un equipo nuevo",
    },
    organizationCreationDisabled: {
      title: "Necesitas una invitación",
      subtitle: "Pide a un compañero que te invite a su equipo",
    },
  },
};
