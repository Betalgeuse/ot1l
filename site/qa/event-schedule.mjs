import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import worker from "../src/index.ts";

const token = `${"a".repeat(40)}.${"b".repeat(64)}`;
const calls = [];
const env = {
  ASSETS: {
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/event-schedule.html")
        return new Response('<body data-event-token="__EVENT_TOKEN__"><script src="/event-schedule.js"></script>');
      return new Response("not found", { status: 404 });
    },
  },
  CORE: {
    async fetch(request) {
      calls.push({ path: new URL(request.url).pathname, body: await request.json(), headers: request.headers });
      return Response.json({ event: { eventId: "VEVENT-1" } });
    },
  },
  RATE_LIMITER: { async limit() { return { success: true }; } },
  TURNSTILE_SITE_KEY: "unused",
  SITE_CORE_HMAC_SECRET: "site-secret",
  EVENT_CORE_HMAC_SECRET: "event-secret",
};

const page = await worker.fetch(new Request(`https://ot1l.hyuk.me/events/schedule/${token}`), env);
assert.equal(page.status, 200);
assert.match(await page.text(), new RegExp(token.replaceAll(".", "[.]")));
const state = await worker.fetch(new Request("https://ot1l.hyuk.me/bridge/state", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }),
}), env);
assert.equal(state.status, 200);
assert.equal(calls[0].path, "/internal/events/state");
assert.equal(calls[0].body.token, token);
assert.match(calls[0].headers.get("x-otl-signature"), /^[0-9a-f]{64}$/);
assert.match(readFileSync("site/dist/event-schedule.html", "utf8"), /data-duration/);
assert.match(readFileSync("site/dist/event-schedule.js", "utf8"), /durationMinutes/);
assert.doesNotMatch(readFileSync("site/dist/event-schedule.js", "utf8"), /api\/events\/schedule/);
assert.match(readFileSync("site/dist/event-schedule.js", "utf8"), /\[title, [.]?[.]?[.]description\] = event[.]activity[.]split/);
assert.match(readFileSync("site/dist/event-schedule.html", "utf8"), /event-schedule[.]js[?]v=20261006-2/);
assert.match(readFileSync("site/dist/event-schedule.html", "utf8"), /data-participants/);
assert.match(readFileSync("site/dist/event-schedule.html", "utf8"), /data-event-people/);
assert.match(readFileSync("site/dist/event-schedule.html", "utf8"), /최대 인원/);
assert.match(readFileSync("site/dist/event-schedule.html", "utf8"), /비워 두면 무제한/);
assert.match(readFileSync("site/dist/event-schedule.html", "utf8"), /<select data-day-start><\/select>/);
assert.match(readFileSync("site/dist/event-schedule.html", "utf8"), /<select data-day-end><\/select>/);
assert.match(readFileSync("site/dist/event-schedule.js", "utf8"), /최대 인원.*무제한/);
assert.doesNotMatch(readFileSync("site/dist/event-schedule.js", "utf8"), /app[.]slack[.]com\/team/);

class FakeElement {
  constructor() {
    this.children = [];
    this.dataset = {};
    this.value = "";
    this.checked = false;
    this.hidden = false;
    this.textContent = "";
    this.className = "";
    this.listeners = new Map();
    this.attributes = new Map();
    this.style = { setProperty() {} };
    this.classList = {
      add: (...names) => { this.className = [...new Set([...this.className.split(" ").filter(Boolean), ...names])].join(" "); },
      toggle: (name, enabled) => {
        const names = new Set(this.className.split(" ").filter(Boolean));
        enabled ? names.add(name) : names.delete(name);
        this.className = [...names].join(" ");
      },
    };
  }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  append(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes.set(name, value); }
}

const selectors = [
  "[data-event-title]", "[data-event-description]", "[data-event-location]", "[data-event-people]",
  "[data-participants-section]", "[data-participants]", "[data-host-config]", "[data-empty]",
  "[data-grid-section]", "[data-finalize]", "[data-start-date]", "[data-end-date]", "[data-min]",
  "[data-capacity]", "[data-grid]", "[data-selected-count]", "[data-status]", "[data-day-start]",
  "[data-day-end]", "[data-step]", "[data-kind]", "[data-recurrence]", "[data-occurrences]",
  "[data-duration]", "[data-deadline]", "[data-grace]", "[data-auto-cancel]", "[data-configure]",
  "[data-save]",
];
const elements = Object.fromEntries(selectors.map((selector) => [selector, new FakeElement()]));
Object.assign(elements["[data-step]"], { value: "30" });
Object.assign(elements["[data-kind]"], { value: "gathering" });
Object.assign(elements["[data-recurrence]"], { value: "1" });
Object.assign(elements["[data-occurrences]"], { value: "4" });
Object.assign(elements["[data-duration]"], { value: "60" });
Object.assign(elements["[data-min]"], { value: "2" });
Object.assign(elements["[data-capacity]"], { value: "" });
Object.assign(elements["[data-deadline]"], { value: "" });
Object.assign(elements["[data-grace]"], { value: "24" });
Object.assign(elements["[data-auto-cancel]"], { checked: true });
Object.assign(elements["[data-start-date]"], { value: "2026-10-12" });
Object.assign(elements["[data-end-date]"], { value: "2026-10-12" });

const browserToken = `${Buffer.from(JSON.stringify({ userId: "UHOST" })).toString("base64url")}.${"b".repeat(64)}`;
const baseEvent = {
  eventId: "VEVENT-30", activity: "30분 시작 테스트", location: "온라인", hostUserId: "UHOST",
  minConfirmed: 2, capacity: null, goingCount: 1, participantProfiles: [], poll: null, options: [], selected: [],
};
const browserCalls = [];
const document = {
  body: { dataset: { eventToken: browserToken } },
  querySelector: (selector) => elements[selector],
  querySelectorAll: (selector) => selector === ".event-slot[data-value]"
    ? elements["[data-grid]"].children.filter((child) => child.dataset.value)
    : [],
  createElement: () => new FakeElement(),
  addEventListener() {},
};
const browserFetch = async (path, init) => {
  const body = JSON.parse(init.body);
  browserCalls.push({ path, body });
  if (path === "/bridge/state") return Response.json({ event: baseEvent });
  if (path === "/bridge/configure") return Response.json({ event: {
    ...baseEvent,
    poll: { startDate: body.startDate, endDate: body.endDate, dayStart: body.dayStart, dayEnd: body.dayEnd, stepMinutes: body.stepMinutes },
    options: [
      { startsAt: "2026-10-12T00:30:00.000Z", votes: 0 },
      { startsAt: "2026-10-12T01:00:00.000Z", votes: 0 },
    ],
  } });
  throw new Error(`unexpected browser fetch ${path}`);
};
runInNewContext(readFileSync("site/dist/event-schedule.js", "utf8"), {
  document, fetch: browserFetch, Response, Intl, Date, JSON, Set, Number, Error, atob,
});
await new Promise((resolve) => setImmediate(resolve));
assert.equal(elements["[data-day-start]"].children.length, 48);
assert.equal(elements["[data-day-end]"].children.length, 48);
assert.equal(elements["[data-day-start]"].children[19].value, "09:30");
assert.equal(elements["[data-day-start]"].children[19].textContent, "09:30");
elements["[data-day-start]"].value = "09:30";
elements["[data-day-end]"].value = "11:30";
await elements["[data-configure]"].listeners.get("click")();
const configureCall = browserCalls.find((call) => call.path === "/bridge/configure");
assert.equal(configureCall.body.dayStart, "09:30");
assert.equal(configureCall.body.dayEnd, "11:30");
assert.equal(configureCall.body.stepMinutes, 30);
assert.deepEqual(
  elements["[data-grid]"].children.filter((child) => child.className === "event-grid-time").map((child) => child.textContent),
  ["09:30", "10:00"],
);
const callCount = browserCalls.length;
elements["[data-day-start]"].value = "09:15";
await elements["[data-configure]"].listeners.get("click")();
assert.equal(browserCalls.length, callCount);
assert.equal(elements["[data-status]"].textContent, "시작과 종료 시각은 30분 단위로 선택해 주세요.");

const scheduleCss = readFileSync("site/dist/styles.css", "utf8");
assert.match(scheduleCss, /--paper:#101713/);
assert.match(scheduleCss, /--ink:#f3f1e8/);
assert.match(scheduleCss, /color-scheme:dark/);
assert.match(scheduleCss, /\.event-schedule-page\{background:var\(--paper\)/);
assert.match(scheduleCss, /\.event-schedule-header\{[^}]*background:var\(--paper-preview\)/);
assert.match(scheduleCss, /\.event-config-grid input,[^{]+\{[^}]*background:var\(--paper\);color:var\(--ink\)/);
assert.match(scheduleCss, /\.event-slot\{[^}]*background:var\(--paper\);color:var\(--ink\)/);
assert.doesNotMatch(scheduleCss, /\.event-schedule-page\{[^}]*#f5f1e7/);
assert.doesNotMatch(scheduleCss, /\.event-(?:schedule-header|config|grid-wrap|slot)[^{]*\{[^}]*(?:#fff|rgba\(255,255,255)/);

console.log("PASS event schedule uses the shared dark design tokens and preserves schedule behavior");
