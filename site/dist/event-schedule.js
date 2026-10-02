const token = document.body.dataset.eventToken;
const state = { event: null, selected: new Set(), painting: null };
const $ = (selector) => document.querySelector(selector);
const api = async (operation, payload = {}) => {
  const response = await fetch(`/api/event-time/${operation}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, ...payload }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "unavailable");
  return body.event;
};
const local = (iso) =>
  new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
const dayKey = (iso) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
const viewer = () => {
  const data = token.split(".")[0];
  return JSON.parse(
    atob(data.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (data.length % 4)) % 4)),
  ).userId;
};
function render(event) {
  state.event = event;
  state.selected = new Set(event.selected);
  $("[data-event-title]").textContent = event.activity;
  $("[data-event-location]").textContent = `장소: ${event.location}`;
  const host = event.hostUserId === viewer();
  $("[data-host-config]").hidden = !(host && !event.poll);
  $("[data-empty]").hidden = Boolean(event.poll) || host;
  $("[data-grid-section]").hidden = !event.poll;
  $("[data-finalize]").hidden = !(host && event.poll);
  if (!event.poll) return;
  const grid = $("[data-grid]");
  grid.replaceChildren();
  const days = [...new Set(event.options.map((option) => dayKey(option.startsAt)))];
  grid.style.setProperty("--event-days", String(days.length));
  const corner = document.createElement("div");
  corner.className = "event-grid-corner";
  grid.append(corner);
  for (const day of days) {
    const cell = document.createElement("div");
    cell.className = "event-grid-day";
    cell.textContent = day;
    grid.append(cell);
  }
  const grouped = new Map();
  for (const option of event.options) {
    const time = local(option.startsAt).split(" ").at(-1);
    if (!grouped.has(time)) grouped.set(time, new Map());
    grouped.get(time).set(dayKey(option.startsAt), option);
  }
  for (const [time, values] of grouped) {
    const label = document.createElement("div");
    label.className = "event-grid-time";
    label.textContent = time;
    grid.append(label);
    for (const day of days) {
      const option = values.get(day);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "event-slot";
      button.disabled = !option;
      if (option) {
        button.dataset.value = option.startsAt;
        button.dataset.votes = String(option.votes);
        button.setAttribute("aria-label", `${local(option.startsAt)}, 가능 ${option.votes}명`);
      }
      grid.append(button);
    }
  }
  sync();
}
function sync() {
  for (const slot of document.querySelectorAll(".event-slot[data-value]")) {
    const selected = state.selected.has(slot.dataset.value);
    slot.classList.toggle("is-selected", selected);
    slot.textContent = `${selected ? "✓" : ""}${slot.dataset.votes === "0" ? "" : slot.dataset.votes}`;
    slot.setAttribute("aria-pressed", String(selected));
  }
  $("[data-selected-count]").textContent = `${state.selected.size}개 선택`;
}
function toggle(slot, selected) {
  if (!slot.dataset.value) return;
  selected ? state.selected.add(slot.dataset.value) : state.selected.delete(slot.dataset.value);
  sync();
}
document.addEventListener("pointerdown", (event) => {
  const slot = event.target.closest(".event-slot[data-value]");
  if (!slot) return;
  state.painting = !state.selected.has(slot.dataset.value);
  toggle(slot, state.painting);
  slot.setPointerCapture?.(event.pointerId);
});
document.addEventListener("pointerover", (event) => {
  if (state.painting === null || event.buttons !== 1) return;
  const slot = event.target.closest(".event-slot[data-value]");
  if (slot) toggle(slot, state.painting);
});
document.addEventListener("pointerup", () => {
  state.painting = null;
});
$("[data-configure]").addEventListener("click", async () => {
  const status = $("[data-status]");
  status.textContent = "시간표를 여는 중…";
  try {
    const deadline = $("[data-deadline]").value;
    render(
      await api("configure", {
        startDate: $("[data-start-date]").value,
        endDate: $("[data-end-date]").value,
        dayStart: $("[data-day-start]").value,
        dayEnd: $("[data-day-end]").value,
        stepMinutes: Number($("[data-step]").value),
        eventKind: $("[data-kind]").value,
        recurrenceEveryWeeks: Number($("[data-recurrence]").value),
        occurrenceCount: Number($("[data-occurrences]").value),
        durationMinutes: Number($("[data-duration]").value),
        minConfirmed: Number($("[data-min]").value),
        capacity: $("[data-capacity]").value ? Number($("[data-capacity]").value) : null,
        recruitmentDeadline: deadline ? new Date(deadline).toISOString() : null,
        graceHours: Number($("[data-grace]").value),
        autoCancel: $("[data-auto-cancel]").checked,
      }),
    );
    status.textContent = "시간표를 열었습니다.";
  } catch {
    status.textContent = "시간표를 열지 못했습니다. 입력을 확인해 주세요.";
  }
});
$("[data-save]").addEventListener("click", async () => {
  const status = $("[data-status]");
  status.textContent = "저장 중…";
  try {
    render(await api("vote", { selected: [...state.selected] }));
    status.textContent = "가능한 시간을 저장했습니다.";
  } catch {
    status.textContent = "저장하지 못했습니다. Slack에서 링크를 다시 열어 주세요.";
  }
});
$("[data-finalize]").addEventListener("click", async () => {
  const status = $("[data-status]");
  const startsAt = [...state.selected][0];
  if (!startsAt) {
    status.textContent = "확정할 시간 한 칸을 먼저 선택해 주세요.";
    return;
  }
  status.textContent = "일정을 확정하는 중…";
  try {
    render(await api("finalize", { startsAt }));
    status.textContent = "최종 일정을 확정했습니다. Slack에서 참가를 확인해 주세요.";
  } catch {
    status.textContent = "일정을 확정하지 못했습니다.";
  }
});
api("state")
  .then(render)
  .catch(() => {
    $("[data-event-location]").textContent =
      "이벤트 링크를 확인할 수 없습니다. Slack에서 다시 열어 주세요.";
  });
