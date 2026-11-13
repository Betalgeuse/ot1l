// The bug delivery clock was retired when the feedback intake was unhooked. Callers still
// compile against this no-op until the feedback files are deleted.
export const BUG_DELIVERY_CLOCK_ROLE = "bug_delivery" as const;

export type BugDeliveryArm =
  | { readonly reason: "cron"; readonly observedAt: number }
  | { readonly reason: "activity"; readonly observedAt: number }
  | { readonly reason: "due"; readonly observedAt: number; readonly nextDue: number };

export type BugDeliveryArmResult = {
  readonly role: typeof BUG_DELIVERY_CLOCK_ROLE;
  readonly armed: boolean;
  readonly next: number | null;
};

export async function armBugDeliveryClock(
  _env: unknown,
  _input: BugDeliveryArm,
): Promise<BugDeliveryArmResult> {
  return { role: BUG_DELIVERY_CLOCK_ROLE, armed: false, next: null };
}
