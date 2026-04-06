import { SiteFooter } from "@/components/site-footer";

export default function DashboardLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      {children}
      <SiteFooter />
    </div>
  );
}
