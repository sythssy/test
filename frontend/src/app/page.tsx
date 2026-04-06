import { redirect } from "next/navigation";
import { getCurrentUserProfile } from "@/lib/auth";

export default async function HomePage() {
  const profile = await getCurrentUserProfile();

  if (!profile) {
    redirect("/auth");
  }

  redirect(profile.role === "admin" ? "/admin" : "/dashboard");
}
