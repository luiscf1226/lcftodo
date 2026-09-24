import { AppShell } from "./AppShell";

export default function Layout({ children }: LayoutProps<"/app">) {
  return <AppShell>{children}</AppShell>;
}
