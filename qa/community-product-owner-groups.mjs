import assert from "node:assert/strict";
import {
  currentProductOwnerSpecialties,
  ensureProductOwnerGroups,
  openProductOwnerSpecialties,
  setProductOwnerSpecialties,
  submitProductOwnerSpecialties,
  syncProductOwnerBaseGroup,
} from "../src/community-product-owner-groups.ts";

const calls = [];
const groups = [
  { id: "SPO", handle: "po", name: "Product Owners", date_delete: 0, users: ["UOTHER"] },
  { id: "SDESIGN", handle: "po-designer", name: "PO Designers", date_delete: 0, users: ["UPO"] },
  { id: "SDEV", handle: "po-dev", name: "PO Developers", date_delete: 0, users: [] },
];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const method = new URL(url).pathname.split("/").at(-1);
  const body = options.body ? JSON.parse(options.body) : {};
  calls.push({ method, body });
  if (method === "usergroups.list") return Response.json({ ok: true, usergroups: groups });
  if (method === "usergroups.users.update") {
    const group = groups.find((item) => item.id === body.usergroup);
    group.users = [...body.users];
    group.date_delete = 0;
    return Response.json({ ok: true, usergroup: group });
  }
  if (method === "usergroups.disable") {
    const group = groups.find((item) => item.id === body.usergroup);
    group.date_delete = 1;
    return Response.json({ ok: true, usergroup: group });
  }
  if (method === "usergroups.enable") {
    const group = groups.find((item) => item.id === body.usergroup);
    group.date_delete = 0;
    return Response.json({ ok: true, usergroup: group });
  }
  if (method === "usergroups.update") {
    const group = groups.find((item) => item.id === body.usergroup);
    Object.assign(group, body);
    return Response.json({ ok: true, usergroup: group });
  }
  if (method === "usergroups.create") {
    const group = {
      id: "S" + String(groups.length + 1),
      handle: body.handle,
      name: body.name,
      date_delete: 0,
      users: [],
    };
    groups.push(group);
    return Response.json({ ok: true, usergroup: group });
  }
  if (method === "views.open" || method === "chat.postEphemeral")
    return Response.json({ ok: true });
  throw new Error("unexpected " + method);
};

const context = {
  env: { SLACK_BOT_TOKEN: "fake" },
  scope: { teamId: "TQA", channelId: "CPO", userId: "UPO" },
  store: { async maintainerStatus() { return { state: "active" }; } },
};

try {
  await syncProductOwnerBaseGroup("fake", "UPO", true);
  assert.deepEqual(groups.find((group) => group.handle === "po").users, ["UOTHER", "UPO"]);
  assert.deepEqual(await currentProductOwnerSpecialties("fake", "UPO"), ["designer"]);

  await openProductOwnerSpecialties(context, "trigger");
  const modal = calls.find((call) => call.method === "views.open").body.view;
  assert.equal(modal.callback_id, "community_po_specialties_submit");
  assert.deepEqual(
    modal.blocks[0].element.initial_options.map((option) => option.value),
    ["designer"],
  );

  await submitProductOwnerSpecialties(context, {
    state: {
      values: {
        specialties: { value: { selected_options: [{ value: "dev" }] } },
      },
    },
  });
  assert.equal(groups.find((group) => group.handle === "po-designer").date_delete, 1);
  assert.deepEqual(groups.find((group) => group.handle === "po-dev").users, ["UPO"]);
  assert.deepEqual(await currentProductOwnerSpecialties("fake", "UPO"), ["dev"]);
  assert.match(
    calls.filter((call) => call.method === "chat.postEphemeral").at(-1).body.text,
    /@po-dev/,
  );

  await setProductOwnerSpecialties("fake", "UPO", ["designer", "dev"]);
  assert.equal(groups.find((group) => group.handle === "po-designer").date_delete, 0);
  assert.deepEqual(await currentProductOwnerSpecialties("fake", "UPO"), ["designer", "dev"]);

  await ensureProductOwnerGroups("fake", {
    po: ["CPO", "CWORK"],
    designer: ["CDESIGN"],
    dev: ["CDEV"],
  });
  assert.equal(calls.filter((call) => call.method === "usergroups.update").length, 3);
  console.log("PASS Product Owner mention groups sync, specialize, remove, restore and read back");
} finally {
  globalThis.fetch = originalFetch;
}
