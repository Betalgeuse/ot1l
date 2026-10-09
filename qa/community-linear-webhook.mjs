import assert from "node:assert/strict";
import {handleLinearWebhook} from "../src/community-linear-webhook.ts";
const original = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("Retired webhook must have no effects"); };
try { assert.equal((await handleLinearWebhook(new Request("https://worker.example/linear/webhook",{method:"POST",body:"{}"}),{},()=>{throw Error("no background mutation")})).status,410); console.log("PASS retired Linear webhook cannot alter native work"); }
finally {globalThis.fetch=original;}
