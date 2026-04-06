import { PLATFORM_USAGE_RULE_BANNER } from "@/lib/billing-labels";

export function PlatformUsageNotice() {
  return (
    <div
      role="note"
      className="border-b border-amber-200/90 bg-amber-50 px-4 py-2.5 text-center text-sm leading-relaxed text-amber-950 shadow-sm dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100"
    >
      {PLATFORM_USAGE_RULE_BANNER}
    </div>
  );
}
