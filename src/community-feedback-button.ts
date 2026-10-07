import type { Json } from "./input";
import {
  FEEDBACK_CONTROL,
  PRODUCT_OWNER_CONTROL,
} from "./slack-presentation/product-owner-controls";

type ButtonPresentation = {
  readonly text: string;
  readonly style: "primary";
  readonly accessibilityLabel: string;
};

export function feedbackButton(presentation: ButtonPresentation = FEEDBACK_CONTROL): Json {
  return {
    type: "button",
    text: { type: "plain_text", text: presentation.text },
    style: presentation.style,
    action_id: "community_bug_open",
    value: JSON.stringify({ ownerId: "actor", key: "new" }),
    accessibility_label: presentation.accessibilityLabel,
  };
}

export function feedbackActionBlock(): Json {
  return { type: "actions", elements: [feedbackButton()] };
}

export function productOwnerButton(): Json {
  return {
    type: "button",
    text: { type: "plain_text", text: PRODUCT_OWNER_CONTROL.text },
    style: PRODUCT_OWNER_CONTROL.style,
    action_id: "community_maintainer_activate",
    value: JSON.stringify({ ownerId: "actor", key: "maintainer-self-activate" }),
    accessibility_label: PRODUCT_OWNER_CONTROL.accessibilityLabel,
  };
}
