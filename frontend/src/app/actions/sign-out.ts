"use server";

import { redirect } from "next/navigation";
import { internalRequest } from "@/lib/server/internal-api";

export async function signOutAction() {
  await internalRequest("/api/auth/signout", { method: "POST" });
  redirect("/auth");
}
