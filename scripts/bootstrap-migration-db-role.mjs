import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

for (const name of [
  "DATABASE_URL",
  "MIGRATION_SECRET_SINK",
  "MIGRATION_SECRET_SINK_ARGS",
])
  if (!process.env[name]) throw new Error(`Missing ${name}`);

function sinkArgs() {
  try {
    const value = JSON.parse(process.env.MIGRATION_SECRET_SINK_ARGS);
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.length > 0))
      throw new TypeError("invalid sink arguments");
    return value;
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError)
      throw new Error("Invalid MIGRATION_SECRET_SINK_ARGS");
    throw error;
  }
}

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function databaseEnvironment(url) {
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGDATABASE: url.pathname.slice(1),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: url.searchParams.get("sslmode") ?? "require",
    PGCHANNELBINDING: url.searchParams.get("channel_binding") ?? "require",
    PGCONNECT_TIMEOUT: "10",
  };
}

let ownerUrl;
try {
  ownerUrl = new URL(process.env.DATABASE_URL);
} catch {
  throw new Error("Invalid owner database URL");
}
if (!['postgres:', 'postgresql:'].includes(ownerUrl.protocol) || !ownerUrl.username || !ownerUrl.password)
  throw new Error("Invalid owner database URL");

const login = "otl_migration_login";
const ownerRole = "otl_migration_owner";
const password = randomBytes(32).toString("base64url");
const sql = `BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${ownerRole}') THEN
  CREATE ROLE ${ownerRole} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${login}') THEN
  CREATE ROLE ${login} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
 END IF;
END $$;
ALTER ROLE ${login} NOCREATEDB NOCREATEROLE NOINHERIT;
ALTER ROLE ${login} PASSWORD ${sqlLiteral(password)};
DO $$ DECLARE membership record; BEGIN
 FOR membership IN
  SELECT parent.rolname AS parent_name,member.rolname AS member_name
  FROM pg_auth_members am JOIN pg_roles parent ON parent.oid=am.roleid
  JOIN pg_roles member ON member.oid=am.member
  WHERE member.rolname='${login}' AND parent.rolname<>'${ownerRole}'
 LOOP EXECUTE format('REVOKE %I FROM %I',membership.parent_name,membership.member_name); END LOOP;
END $$;
GRANT ${ownerRole} TO ${login};
DO $$ BEGIN EXECUTE format('GRANT ${ownerRole} TO %I',current_user); END $$;
ALTER SCHEMA otl OWNER TO ${ownerRole};
DO $$ DECLARE item record; BEGIN
 FOR item IN
  SELECT c.relkind,n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='otl' AND c.relkind IN ('r','p','S','v','m')
    AND (c.relkind<>'S' OR NOT EXISTS(
      SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid
      AND d.refclassid='pg_class'::regclass AND d.deptype IN ('a','i')))
  ORDER BY CASE WHEN c.relkind IN ('r','p') THEN 0 ELSE 1 END
 LOOP
  EXECUTE format(
    CASE item.relkind WHEN 'S' THEN 'ALTER SEQUENCE %I.%I OWNER TO ${ownerRole}'
      WHEN 'v' THEN 'ALTER VIEW %I.%I OWNER TO ${ownerRole}'
      WHEN 'm' THEN 'ALTER MATERIALIZED VIEW %I.%I OWNER TO ${ownerRole}'
      ELSE 'ALTER TABLE %I.%I OWNER TO ${ownerRole}' END,
    item.nspname,item.relname);
 END LOOP;
 FOR item IN
  SELECT p.oid::regprocedure::text AS identity FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='otl'
 LOOP EXECUTE 'ALTER ROUTINE '||item.identity||' OWNER TO ${ownerRole}'; END LOOP;
 FOR item IN
  SELECT n.nspname,t.typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
  WHERE n.nspname='otl' AND t.typtype IN ('e','d')
 LOOP EXECUTE format('ALTER TYPE %I.%I OWNER TO ${ownerRole}',item.nspname,item.typname); END LOOP;
END $$;
REVOKE ALL ON SCHEMA otl FROM ${login};
REVOKE ALL ON ALL TABLES IN SCHEMA otl FROM ${login};
REVOKE ALL ON ALL SEQUENCES IN SCHEMA otl FROM ${login};
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA otl FROM ${login};
COMMIT;`;
const psql = spawnSync(process.env.PSQL_BIN ?? "psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1"], {
  input: sql,
  encoding: "utf8",
  env: databaseEnvironment(ownerUrl),
  stdio: ["pipe", "pipe", "pipe"],
});
if (psql.status !== 0) {
  if (process.env.MIGRATION_BOOTSTRAP_DIAGNOSTICS === "true")
    console.error(
      String(psql.stderr)
        .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[database-url-redacted]")
        .replace(/PASSWORD\s+'[^']+'/gi, "PASSWORD '[redacted]'"),
    );
  throw new Error("Migration database role bootstrap failed; details withheld");
}

const migrationUrl = new URL(ownerUrl);
migrationUrl.username = login;
migrationUrl.password = password;
const sink = spawnSync(process.env.MIGRATION_SECRET_SINK, sinkArgs(), {
  input: `${migrationUrl.toString()}\n`,
  encoding: "utf8",
  stdio: ["pipe", "pipe", "pipe"],
});
if (sink.status !== 0) throw new Error("Migration secret delivery failed");
console.log(JSON.stringify({ rolesConfigured: 2, secretsDelivered: 1 }));
