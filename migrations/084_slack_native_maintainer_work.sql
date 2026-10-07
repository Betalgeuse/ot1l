BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('otl:slack-native-maintainer-work:084',0));

-- The application-side Slack-native work flow shipped independently of its
-- migration receipt.  Keep this forward migration as the durable boundary so
-- deployments can prove that the database has crossed that release.
INSERT INTO otl.schema_migrations(version) VALUES('084-slack-native-maintainer-work');
COMMIT;
