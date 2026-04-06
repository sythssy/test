import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function EditorBookPage({
  params
}: {
  params: { bookId: string };
}) {
  const profile = await requireAuth();
  const supabase = createSupabaseServerClient();

  const { data: book } = await supabase
    .from("books")
    .select("id,user_id")
    .eq("id", params.bookId)
    .single();

  if (!book || book.user_id !== profile.id) {
    redirect("/dashboard");
  }

  const { data: firstChapter } = await supabase
    .from("chapters")
    .select("id")
    .eq("book_id", params.bookId)
    .order("order_index", { ascending: true })
    .limit(1)
    .single();

  if (firstChapter?.id) {
    redirect(`/editor/${params.bookId}/${firstChapter.id}`);
  }

  redirect("/dashboard");
}
