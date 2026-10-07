export type SlackChangeClass = "open" | "core";

export function mergeApprovalAudience(changeClass: SlackChangeClass): string {
  return changeClass === "open"
    ? "Open · 활성 Product Owner 또는 Founder가 승인하면 병합과 배포가 연속 실행됩니다."
    : "Core · Founder 승인 뒤 병합과 배포가 연속 실행됩니다.";
}

export function mergeApprovalButtonLabel(changeClass: SlackChangeClass): string {
  return changeClass === "core" ? "Founder 병합·배포 승인" : "Product Owner 병합·배포 승인";
}
