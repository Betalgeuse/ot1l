import { InputError, object, string } from "./input";
import { sign, verify } from "./signing";

export type EventLinkIdentity = {
  readonly teamId: string;
  readonly channelId: string;
  readonly eventId: string;
  readonly userId: string;
};

export async function eventScheduleToken(
  identity: EventLinkIdentity,
  secret: string,
): Promise<string> {
  const body = JSON.stringify({ ...identity, expires: Math.floor(Date.now() / 1000) + 7 * 86400 });
  const data = btoa(body).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return `${data}.${await sign(data, secret)}`;
}

export async function readEventScheduleToken(
  token: string,
  secret: string,
): Promise<EventLinkIdentity> {
  if (token.length > 2000) throw new InputError("이벤트 링크가 너무 깁니다.");
  const [data, signature, extra] = token.split(".");
  if (!data || !signature || extra || !(await verify(data, signature, secret)))
    throw new InputError("이벤트 링크가 유효하지 않습니다.");
  const decoded = object(
    JSON.parse(
      atob(
        data.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (data.length % 4)) % 4),
      ),
    ),
  );
  if (typeof decoded.expires !== "number" || decoded.expires < Date.now() / 1000)
    throw new InputError("이벤트 링크가 만료됐습니다. Slack에서 다시 열어 주세요.");
  const identity = {
    teamId: string(decoded.teamId),
    channelId: string(decoded.channelId),
    eventId: string(decoded.eventId),
    userId: string(decoded.userId),
  };
  if (
    !/^[A-Z0-9-]+$/.test(identity.teamId) ||
    !/^[CG][A-Z0-9]+$/.test(identity.channelId) ||
    !/^V[A-Z0-9-]{1,80}$/.test(identity.eventId) ||
    !/^[UW][A-Z0-9]+$/.test(identity.userId)
  )
    throw new InputError("이벤트 링크 범위를 확인할 수 없습니다.");
  return identity;
}
