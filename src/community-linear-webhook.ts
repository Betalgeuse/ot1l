// Historical webhook URL is retained only to tell the retired integration to stop.
export async function handleLinearWebhook(
  _request: Request,
  _env: unknown,
  _waitUntil: (promise: Promise<unknown>) => void,
): Promise<Response> {
  return new Response("Linear work integration retired; Slack is authoritative.", { status: 410 });
}
