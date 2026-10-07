export const PRODUCT_OWNER_BUTTON = {
  text: "Product Owner 되기",
  style: "primary",
  accessibilityLabel: "OT1L Product Owner로 참여하기",
} as const;

export const PRODUCT_OWNER_PROPOSAL_BUTTON = {
  text: "피드백·작업 제안",
  style: "primary",
} as const;

export function dailyFeedbackPresentation(date: string): string {
  return `${date} 오늘 OT1L을 쓰면서 불편했거나 바랐던 점이 있었나요? 작은 의견도 괜찮아요. 아래 버튼으로 편하게 남겨주세요. 피드백을 남겨주시면 봇이 자동으로 수정안을 만들고, Product Owner가 확인한 뒤 배포해요! Product Owner(PO)는 코딩 여부와 관계없이 회원 문제를 발견하고 개선을 끝까지 맡는 역할이에요.`;
}

export function dailyProductOwnerPresentation(date: string): string {
  return `${date} 오늘 OT1L을 함께 만들며 불편했던 점, 해보고 싶은 변화, 같이 배우거나 열어보고 싶은 활동이 있었나요? 작은 아이디어·질문·도움 요청도 괜찮아요. 아래 버튼으로 남기면 함께할 사람을 찾고 AI의 도움을 받아 실제 변화로 이어갈 수 있어요.`;
}

export function approvalButtonText(changeClass: "open" | "core"): string {
  return changeClass === "core" ? "Founder 병합·배포 승인" : "Product Owner 병합·배포 승인";
}
