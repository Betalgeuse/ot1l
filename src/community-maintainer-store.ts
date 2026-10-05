import type { CommunityEnv } from "./community-runtime";
import { type Json, object } from "./input";
import { NeonStore } from "./store";

export class MaintainerOpsStore {
  constructor(
    private readonly env: Pick<
      CommunityEnv,
      "DATABASE_URL" | "SLACK_TEAM_ID" | "COMMUNITY_ADMIN_ID"
    >,
  ) {}

  async execute(
    op: string,
    payload: Record<string, Json>,
    actorId = this.env.COMMUNITY_ADMIN_ID,
  ): Promise<Json> {
    return new NeonStore(this.env.DATABASE_URL).queryJson(
      "SELECT otl.maintainer_ops_execute($1,$2::jsonb)",
      [
        op,
        JSON.stringify({
          ...payload,
          teamId: this.env.SLACK_TEAM_ID,
          actorId,
          founderId: this.env.COMMUNITY_ADMIN_ID,
        }),
      ],
    );
  }

  async getWork(workKey: string): Promise<Record<string, unknown> | null> {
    const value = await this.execute("work_get", { workKey });
    return value === null ? null : object(value);
  }
}
