// Only bounded categories may leave the runtime. Never log the original
// exception message: it can contain database URLs, tokens or member content.
export function runtimeFailureCode(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";
  if (/too many (?:api )?subrequests/i.test(error.message)) return "subrequest_limit";
  if (/too many simultaneous|connection limit/i.test(error.message)) return "connection_limit";
  if (/exceeded the quota/i.test(error.message)) return "db_quota_exceeded";
  if (error.name === "TimeoutError" || error.name === "AbortError") return "timeout_or_abort";
  if (/network connection lost|fetch failed|network error/i.test(error.message))
    return "network_failure";
  return "unclassified";
}
