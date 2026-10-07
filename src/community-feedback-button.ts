import type { Json } from "./input";
import { PRODUCT_PROPOSAL_BUTTON } from "./slack-presentation/product-owner-actions";

export function feedbackButton(label = "피드백 남기기", primary = false): Json {
  return {
    type: "button",
    text: { type: "plain_text", text: label },
    action_id: "community_bug_open",
    value: JSON.stringify({ ownerId: "actor", key: "new" }),
    ...(primary ? { style: PRODUCT_PROPOSAL_BUTTON.style } : {}),
    accessibility_label: PRODUCT_PROPOSAL_BUTTON.accessibilityLabel,
  };
}

export function feedbackActionBlock(): Json {
  return { type: "actions", elements: [feedbackButton()] };
}
