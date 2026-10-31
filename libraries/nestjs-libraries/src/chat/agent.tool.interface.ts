import type { ToolAction } from '@mastra/core/tools';
import type { AbilityPolicy } from '@gitroom/nestjs-libraries/permissions/permissions.ability';

export type ToolReturn = ToolAction<any, any, any, any, any, any>;

export interface AgentToolInterface {
  name: string;
  // the web (or public API) routes this tool exposes, as 'METHOD /full/path' keys, e.g. 'POST /posts';
  // an mcp-only tool that mirrors no route (a widget) uses [] and says why
  mirrors: string[];
  // needs an MCP host (e.g. renders a ui:// widget), so the in-app agent doesn't get it
  mcpOnly?: boolean;
  // a tool of a feature this install has not configured is left out everywhere
  available?(): boolean;
  // a self-hosted instance without it can still connect through the cloud
  // relay, calling it there asks to update the instance
  optionalOnSelfHosted?: boolean;
  // the plan limits of the web route this tool mirrors (same tuples as @CheckPolicies),
  // checked before every execution
  policies?: AbilityPolicy[];
  // the internal id of the channel a call reconnects: reconnecting adds no
  // channel, so it skips the channel limit like the `refresh` query of the web
  // route
  refreshChannelId?(inputData: any, orgId: string): Promise<string | undefined>;
  run(): ToolReturn;
}
