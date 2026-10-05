import { execFileSync } from "node:child_process";

// Values arrive on stdin, never in argv, source, logs or a checked-in file.
if (process.argv.slice(2).join(" ") !== "--apply")
  throw new Error("Use --apply with the approved Linear secret envelope on stdin");
let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 4096) throw new Error("Secret envelope too large");
}
const envelope = JSON.parse(input);
const expected = ["LINEAR_API_KEY", "LINEAR_ADMIN_API_KEY", "LINEAR_WEBHOOK_SECRET"];
if (Object.keys(envelope).sort().join() !== [...expected].sort().join())
  throw new Error("Unexpected secret names");
if (!expected.every((name) => typeof envelope[name] === "string") ||
    !/^lin_api_[A-Za-z0-9]+$/.test(envelope.LINEAR_API_KEY) ||
    !/^lin_api_[A-Za-z0-9]+$/.test(envelope.LINEAR_ADMIN_API_KEY) ||
    !/^lin_wh_[A-Za-z0-9]+$/.test(envelope.LINEAR_WEBHOOK_SECRET))
  throw new Error("Invalid secret envelope");
execFileSync("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "genquant",
  "cd /home/opc/otl1-bug-runner/current && set -a && . /home/opc/.config/otl1-bug-runner/env && set +a && node -e 'const c=require(\"./.wrangler.production.json\");if(c.name!==\"otl1-onething-garden\")process.exit(1)' && ./node_modules/.bin/wrangler versions secret bulk --config .wrangler.production.json --tag ot1l-linear-secrets --message 'Approved OT1L-only Linear bridge credentials; staged, not deployed'"],
  { input: JSON.stringify(envelope), stdio: ["pipe", "inherit", "inherit"] });
