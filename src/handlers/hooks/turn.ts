// SPDX-FileCopyrightText: 2026 CoreWeave, Inc.
// SPDX-License-Identifier: Apache-2.0
// SPDX-PackageName: forge-agent-lens-for-openclaw

import type { HandlerDeps } from "../deps.js";
import type { HookCtx, HookEvent, HookHandler } from "../hook-types.js";

// agent_end -> Turn attributes (searchable); message_received -> span event.
export function createTurnHookHandlers(deps: HandlerDeps): {
  agent_end: HookHandler<"agent_end">;
  message_received: HookHandler<"message_received">;
} {
  return {
    agent_end(event: HookEvent<"agent_end">): void {
      if (!event.runId) return;
      const turn = deps.registries.turns.get(event.runId);
      if (!turn) return;
      const attrs: Record<string, string | number | boolean> = {
        "forge.agent.success": event.success,
      };
      if (event.error && deps.getResolved()?.captureContent) attrs["forge.agent.error"] = event.error;
      if (event.durationMs !== undefined && Number.isFinite(event.durationMs)) {
        attrs["forge.agent.duration_ms"] = Math.trunc(event.durationMs);
      }
      turn.setAttributes(attrs);
    },

    message_received(
      event: HookEvent<"message_received">,
      ctx: HookCtx<"message_received">,
    ): void {
      if (!event.runId) return;
      const turn = deps.registries.turns.get(event.runId);
      if (!turn) return;
      const attrs: Record<string, string | number | boolean> = {};
      const resolved = deps.getResolved();
      if (resolved?.captureContent) {
        attrs["forge.message.from"] = event.from;
        attrs["forge.message.channel"] = ctx.channelId;
        attrs["forge.message.content"] = event.content;
      }
      turn.addEvent("message_received", attrs);
    },
  };
}
