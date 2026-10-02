// SPDX-FileCopyrightText: 2026 CoreWeave, Inc.
// SPDX-License-Identifier: Apache-2.0
// SPDX-PackageName: forge-agent-lens-for-openclaw

// Integration identity must land on EVERY span, not just the invoke_agent root,
// so the backend can group/filter chat/tool spans by integration too. Set once at
// the trace root (Conversation, or a rootless Turn); the SDK propagates it down the
// handle chain, which survives each span opening in its own runIsolated frame.

import { describe, it, expect, vi, assert } from "vitest";
import {
  bootPlugin,
  pinInMemoryExporter,
  TRACE,
  runStarted,
  runCompleted,
  modelCallStarted,
  modelCallCompleted,
  toolStarted,
  toolCompleted,
} from "./test/helpers.js";
import { PACKAGE_VERSION } from "./config/version.js";

const exporter = pinInMemoryExporter();

describe("integration attribution", () => {
  it("propagates forge.integration.* to every span under a session (turn, chat, tool)", async () => {
    const { dispatch, finish } = await bootPlugin({ agentName: "test-agent" });

    dispatch.hook("session_start", { sessionKey: "s-1" });
    runStarted(dispatch, { runId: "r-1", sessionKey: "s-1" });
    modelCallStarted(dispatch, { runId: "r-1", callId: "c-1", spanId: "csp" });
    toolStarted(dispatch, { runId: "r-1", toolCallId: "tc-1", spanId: "tcsp", parentSpanId: "csp" });
    toolCompleted(dispatch, { runId: "r-1", toolCallId: "tc-1", spanId: "tcsp" });
    modelCallCompleted(dispatch, { runId: "r-1", callId: "c-1", spanId: "csp" });
    runCompleted(dispatch, { runId: "r-1", sessionKey: "s-1" });
    dispatch.hook("session_end", { sessionKey: "s-1" });
    await finish();

    const spans = exporter.getFinishedSpans();
    const turn = spans.find(s => s.attributes["gen_ai.operation.name"] === "invoke_agent");
    const chat = spans.find(s => s.attributes["gen_ai.operation.name"] === "chat");
    const tool = spans.find(s => s.attributes["gen_ai.operation.name"] === "execute_tool");
    assert(turn);
    assert(chat);
    assert(tool);

    for (const span of [turn, chat, tool]) {
      expect(span.resource.attributes["wandb.sdk.name"]).toBe("forge");
      expect(span.resource.attributes["service.name"]).toBe("openclaw-agent");
      expect(span.attributes["forge.integration.name"]).toBe("forge-agent-lens-for-openclaw");
      expect(span.attributes["forge.integration.version"]).toBe(PACKAGE_VERSION);
    }
  });

  it("propagates to every span on the sessionless fallback (no sessionKey), children included", async () => {
    const { dispatch, finish } = await bootPlugin({ agentName: "test-agent" });

    // run.started with no sessionKey: getOrCreateConversation returns undefined,
    // so the handler opens a rootless Turn carrying INTEGRATION_ATTRIBUTES, which
    // the SDK propagates to the chat and tool spans nested under that Turn.
    dispatch.diagnostic({ type: "run.started", ts: 1000, runId: "r-x", trace: { traceId: "t", spanId: "sp" } });
    modelCallStarted(dispatch, { runId: "r-x", callId: "c-x", spanId: "csp" });
    toolStarted(dispatch, { runId: "r-x", toolCallId: "tc-x", spanId: "tcsp", parentSpanId: "csp" });
    toolCompleted(dispatch, { runId: "r-x", toolCallId: "tc-x", spanId: "tcsp" });
    modelCallCompleted(dispatch, { runId: "r-x", callId: "c-x", spanId: "csp" });
    dispatch.diagnostic({ type: "run.completed", ts: 2000, runId: "r-x", outcome: "completed", trace: { traceId: "t", spanId: "sp" } });
    await finish();

    const spans = exporter.getFinishedSpans();
    const turn = spans.find(s => s.attributes["gen_ai.operation.name"] === "invoke_agent");
    const chat = spans.find(s => s.attributes["gen_ai.operation.name"] === "chat");
    const tool = spans.find(s => s.attributes["gen_ai.operation.name"] === "execute_tool");
    assert(turn);
    assert(chat);
    assert(tool);

    for (const span of [turn, chat, tool]) {
      expect(span.resource.attributes["wandb.sdk.name"]).toBe("forge");
      expect(span.resource.attributes["service.name"]).toBe("openclaw-agent");
      expect(span.attributes["forge.integration.name"]).toBe("forge-agent-lens-for-openclaw");
      expect(span.attributes["forge.integration.version"]).toBe(PACKAGE_VERSION);
    }
  });

  it("emits only forge.* custom keys; weave.compaction.* is the one backend-read survivor", async () => {
    const { dispatch, finish } = await bootPlugin({ agentName: "test-agent", agentDescription: "demo", captureContent: true });

    // Drive every emitter once so a missed rename surfaces as a weave.* key.
    dispatch.hook("session_start", { sessionKey: "s-1" });
    runStarted(dispatch, { runId: "r-1", sessionKey: "s-1" });
    dispatch.diagnostic({ type: "context.assembled", ts: 1001, runId: "r-1", contextTokenBudget: 1000, messageCount: 2, trace: TRACE });
    dispatch.diagnostic({ type: "run.attempt", ts: 1002, runId: "r-1", attempt: 2, trace: TRACE });
    dispatch.hook("message_received", { runId: "r-1", from: "user", content: "hi" }, { channelId: "telegram" });
    modelCallStarted(dispatch, { runId: "r-1", callId: "c-1", spanId: "csp" });
    toolStarted(dispatch, { runId: "r-1", toolCallId: "tc-1", spanId: "tcsp", parentSpanId: "csp" });
    toolCompleted(dispatch, { runId: "r-1", toolCallId: "tc-1", spanId: "tcsp" });
    modelCallCompleted(dispatch, { runId: "r-1", callId: "c-1", spanId: "csp" });
    dispatch.diagnostic({ type: "tool.loop", ts: 1003, sessionKey: "s-1", toolName: "search", level: "warning", action: "warn", detector: "generic_repeat", count: 3, message: "loop" });
    dispatch.diagnostic({ type: "model.usage", ts: 1004, runId: "r-1", costUsd: 0.01, usage: { input: 1, output: 1 }, context: { limit: 1000, used: 10 }, trace: TRACE });
    dispatch.hook("before_compaction", { messageCount: 5 }, { runId: "r-1" });
    dispatch.hook("after_compaction", { messageCount: 2 }, { runId: "r-1" });
    dispatch.hook("subagent_spawned", { runId: "sub-1", agentId: "researcher", label: "search", childSessionKey: "sub-s", mode: "run" }, { runId: "r-1" });
    dispatch.hook("subagent_ended", { runId: "sub-1", outcome: "ok" });
    dispatch.hook("agent_end", { runId: "r-1", success: true, durationMs: 10 });
    runCompleted(dispatch, { runId: "r-1", sessionKey: "s-1" });
    dispatch.hook("session_end", { sessionKey: "s-1" });
    await finish();

    const spans = exporter.getFinishedSpans();
    const keys = new Set<string>();
    for (const span of spans) {
      for (const key of Object.keys(span.attributes)) keys.add(key);
      for (const event of span.events) for (const key of Object.keys(event.attributes ?? {})) keys.add(key);
    }
    expect([...keys].filter(k => k.startsWith("weave.")).sort()).toEqual([
      "weave.compaction.items_after",
      "weave.compaction.items_before",
    ]);
    expect([...keys].filter(k => k.startsWith("forge.")).sort()).toMatchInlineSnapshot(`
      [
        "forge.agent.duration_ms",
        "forge.agent.success",
        "forge.context.budget_tokens",
        "forge.context.message_count",
        "forge.context.used_tokens",
        "forge.cost.usd",
        "forge.integration.name",
        "forge.integration.version",
        "forge.loop.action",
        "forge.loop.count",
        "forge.loop.detector",
        "forge.loop.level",
        "forge.loop.message",
        "forge.message.channel",
        "forge.message.content",
        "forge.message.from",
        "forge.outcome",
        "forge.run.attempt",
        "forge.subagent.mode",
      ]
    `);

    // Agent identity moved to the SDK's gen_ai.agent.* fields.
    const turn = spans.find(s => s.attributes["gen_ai.operation.name"] === "invoke_agent" && s.attributes["gen_ai.agent.name"] === "test-agent");
    assert(turn);
    expect(turn.attributes["gen_ai.agent.version"]).toBe(PACKAGE_VERSION);
    expect(turn.attributes["gen_ai.agent.description"]).toBe("demo");
    const spawned = turn.events.find(e => e.name === "subagent_spawned");
    assert(spawned);
    expect(spawned.attributes).toMatchObject({ "gen_ai.agent.id": "researcher", "gen_ai.agent.description": "search" });
  });
});
