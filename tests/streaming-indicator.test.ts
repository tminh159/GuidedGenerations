import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import { StreamingIndicatorController } from "../src/frontend/streaming-indicator";
import { GUIDED_GENERATIONS_CSS } from "../src/frontend/styles";
import type { ActiveRunState } from "../src/shared/types";

describe("streaming indicator styles", () => {
  test("defines 3-dot bounce animation, optimistic style, and staggered delays", () => {
    expect(GUIDED_GENERATIONS_CSS).toContain(".gg-streaming-indicator");
    expect(GUIDED_GENERATIONS_CSS).toContain(".gg-streaming-indicator--optimistic");
    expect(GUIDED_GENERATIONS_CSS).toContain(".gg-streaming-dot");
    expect(GUIDED_GENERATIONS_CSS).toContain(
      "animation: gg-streaming-bounce 1.2s ease-in-out infinite;",
    );
    expect(GUIDED_GENERATIONS_CSS).toContain(".gg-streaming-dot:nth-child(2)");
    expect(GUIDED_GENERATIONS_CSS).toContain(".gg-streaming-dot:nth-child(3)");
    expect(GUIDED_GENERATIONS_CSS).toContain("@keyframes gg-streaming-bounce");
  });

  test("does not freeze .gg-streaming-dot under prefers-reduced-motion: reduce", () => {
    const reducedMotionBlocks = Array.from(
      GUIDED_GENERATIONS_CSS.matchAll(
        /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\s*\{([\s\S]*?\n)\}/g,
      ),
      (match) => match[1] ?? "",
    );

    expect(reducedMotionBlocks.length).toBeGreaterThan(0);
    for (const block of reducedMotionBlocks) {
      expect(block).not.toContain(".gg-streaming-dot");
      expect(block).not.toContain(".gg-streaming-indicator");
    }
  });
});

describe("StreamingIndicatorController hot-loop optimizations", () => {
  let dom: JSDOM;
  const origDocument = globalThis.document;
  const origWindow = globalThis.window;
  const origMutationObserver = globalThis.MutationObserver;
  const origRaf = globalThis.requestAnimationFrame;
  const origCancelRaf = globalThis.cancelAnimationFrame;

  beforeEach(() => {
    dom = new JSDOM("<!doctype html><html><body></body></html>");
    (globalThis as unknown as { document: Document }).document = dom.window.document;
    (globalThis as unknown as { window: Window }).window = dom.window as unknown as Window;
    (globalThis as unknown as { MutationObserver: typeof MutationObserver }).MutationObserver =
      dom.window.MutationObserver;
  });

  afterEach(() => {
    (globalThis as unknown as { document: typeof origDocument }).document = origDocument;
    (globalThis as unknown as { window: typeof origWindow }).window = origWindow;
    (globalThis as unknown as { MutationObserver: typeof origMutationObserver }).MutationObserver =
      origMutationObserver;
    (globalThis as unknown as { requestAnimationFrame: typeof origRaf }).requestAnimationFrame =
      origRaf;
    (globalThis as unknown as { cancelAnimationFrame: typeof origCancelRaf }).cancelAnimationFrame =
      origCancelRaf;
    dom.window.close();
  });

  function createHarness(
    activeChatId = "chat-1",
    options: { latestMessageId?: string | null; streamAfterMount?: Element | null } = {},
  ) {
    const listeners = new Map<string, Set<(payload: unknown) => void>>();
    const rows = new Map<string, Element>();
    let findCalls = 0;
    let injectCalls = 0;
    let uninjectCalls = 0;

    const ctx = {
      getActiveChat: () => ({ chatId: activeChatId }),
      ...(options.latestMessageId !== undefined
        ? {
            messages: {
              getLatestMessageId: () => options.latestMessageId ?? null,
            },
          }
        : {}),
      ...(options.streamAfterMount !== undefined
        ? {
            ui: {
              mount: (slot: string) =>
                slot === "chat_stream_after" ? options.streamAfterMount! : null,
            },
          }
        : {}),
      events: {
        on: (event: string, cb: (payload: unknown) => void) => {
          let set = listeners.get(event);
          if (!set) {
            set = new Set();
            listeners.set(event, set);
          }
          set.add(cb);
          return () => set?.delete(cb);
        },
      },
      dom: {
        findMessageElement: (messageId: string) => {
          findCalls += 1;
          return rows.get(messageId) ?? null;
        },
        inject: (
          target: string | Element,
          html: string,
          position: InsertPosition = "beforeend",
        ) => {
          const el =
            typeof target === "string" ? document.querySelector(target)! : target;
          const wrapper = document.createElement("div");
          wrapper.setAttribute("data-spindle-injected", "true");
          wrapper.innerHTML = html;
          el.insertAdjacentElement(position, wrapper);
          injectCalls += 1;
          return wrapper;
        },
        uninject: (el: Element) => {
          uninjectCalls += 1;
          el.remove();
        },
      },
    } as unknown as SpindleFrontendContext;

    const emit = (event: string, payload: unknown) => {
      for (const cb of listeners.get(event) ?? []) {
        cb(payload);
      }
    };

    return {
      ctx,
      rows,
      emit,
      getCounts: () => ({ findCalls, injectCalls, uninjectCalls }),
    };
  }

  function makeRun(overrides: Partial<ActiveRunState> = {}): ActiveRunState {
    return {
      runId: "run-1",
      actionId: "guided_response",
      chatId: "chat-1",
      startedAt: Date.now(),
      messageId: "msg-1",
      swipeId: 0,
      hasContentOutput: true,
      ...overrides,
    };
  }

  test("short-circuits syncCurrent() DOM lookups and skips redundant saveRunState() writes on MESSAGE_EDITED when already mounted on MessageContent", () => {
    const h = createHarness();
    const row = document.createElement("div");
    const messageContent = document.createElement("div");
    messageContent.setAttribute("data-component", "MessageContent");
    messageContent.textContent = "Hello";
    row.append(messageContent);
    document.body.append(row);
    h.rows.set("msg-1", row);

    let querySelectorCalls = 0;
    const origQuerySelector = row.querySelector.bind(row);
    row.querySelector = ((selector: string) => {
      querySelectorCalls += 1;
      return origQuerySelector(selector);
    }) as typeof row.querySelector;

    const controller = new StreamingIndicatorController(h.ctx);
    const runStateMap = (
      controller as unknown as { runStateById: Map<string, unknown> }
    ).runStateById;
    let mapSetCalls = 0;
    const origSet = runStateMap.set.bind(runStateMap);
    runStateMap.set = ((key: string, value: unknown) => {
      mapSetCalls += 1;
      return origSet(key, value);
    }) as typeof runStateMap.set;

    try {
      controller.sync(makeRun());
      expect(h.getCounts().findCalls).toBe(1);
      expect(h.getCounts().injectCalls).toBe(1);
      expect(querySelectorCalls).toBe(1);
      expect(messageContent.nextElementSibling?.querySelector(".gg-streaming-indicator--after")).not.toBeNull();

      // First MESSAGE_EDITED flips contentSeen false -> true (1 saveRunState), still short-circuits DOM
      const mapSetBeforeEdits = mapSetCalls;
      h.emit("MESSAGE_EDITED", {
        message: { id: "msg-1", content: "Hello world", swipe_id: 0 },
      });
      expect(mapSetCalls).toBe(mapSetBeforeEdits + 1);
      expect(h.getCounts().findCalls).toBe(1);
      expect(querySelectorCalls).toBe(1);

      // Subsequent streaming MESSAGE_EDITED chunks must do 0 DOM lookups and 0 runState writes
      const mapSetAfterFirstChunk = mapSetCalls;
      for (let i = 0; i < 10; i += 1) {
        h.emit("MESSAGE_EDITED", {
          message: { id: "msg-1", content: `Hello world chunk ${i}`, swipe_id: 0 },
        });
      }
      expect(h.getCounts().findCalls).toBe(1);
      expect(h.getCounts().injectCalls).toBe(1);
      expect(querySelectorCalls).toBe(1);
      expect(mapSetCalls).toBe(mapSetAfterFirstChunk);

      // If MessageContent is replaced in DOM, connected check fails and controller re-resolves cleanly
      messageContent.remove();
      const replacementContent = document.createElement("div");
      replacementContent.setAttribute("data-component", "MessageContent");
      replacementContent.textContent = "Replaced";
      row.append(replacementContent);

      h.emit("MESSAGE_EDITED", {
        message: { id: "msg-1", content: "Replaced chunk", swipe_id: 0 },
      });
      expect(h.getCounts().findCalls).toBe(2);
      expect(h.getCounts().injectCalls).toBe(2);
      expect(replacementContent.nextElementSibling?.querySelector(".gg-streaming-indicator--after")).not.toBeNull();
    } finally {
      controller.destroy();
    }
  });

  test("transitions to scoped MutationObserver after fast RAF retries and does not restart polling on repeated MESSAGE_EDITED when MessageContent is absent", async () => {
    const rafQueue = new Map<number, FrameRequestCallback>();
    let nextRafId = 1;
    let totalRafSchedules = 0;
    (globalThis as unknown as { requestAnimationFrame: typeof requestAnimationFrame }).requestAnimationFrame = (
      cb: FrameRequestCallback,
    ) => {
      totalRafSchedules += 1;
      const id = nextRafId++;
      rafQueue.set(id, cb);
      return id;
    };
    (globalThis as unknown as { cancelAnimationFrame: typeof cancelAnimationFrame }).cancelAnimationFrame = (
      id: number,
    ) => {
      rafQueue.delete(id);
    };

    const flushRaf = () => {
      const entries = [...rafQueue.entries()];
      rafQueue.clear();
      for (const [, cb] of entries) cb(16);
    };

    const h = createHarness();
    const row = document.createElement("div");
    const mountBefore = document.createElement("span");
    mountBefore.setAttribute("data-spindle-mount", "message_body_before");
    row.append(mountBefore);
    document.body.append(row);
    h.rows.set("msg-1", row);

    const controller = new StreamingIndicatorController(h.ctx);
    try {
      controller.sync(makeRun({ hasContentOutput: false }));
      expect(mountBefore.querySelectorAll(".gg-streaming-indicator")).toHaveLength(1);
      expect(rafQueue.size).toBe(0);

      // First text chunk starts content retry (2 fast RAF frames)
      h.emit("MESSAGE_EDITED", {
        message: { id: "msg-1", content: "Token 1", swipe_id: 0 },
      });
      expect(rafQueue.size).toBe(1);
      flushRaf();
      expect(rafQueue.size).toBe(1);

      // After 2nd RAF frame, transitions to MutationObserver — no more RAF polling
      flushRaf();
      expect(rafQueue.size).toBe(0);
      expect(totalRafSchedules).toBe(2);

      // Repeated MESSAGE_EDITED chunks must NOT reset retries or restart RAF polling
      for (let i = 2; i <= 15; i += 1) {
        h.emit("MESSAGE_EDITED", {
          message: { id: "msg-1", content: `Token ${i}`, swipe_id: 0 },
        });
      }
      expect(rafQueue.size).toBe(0);
      expect(totalRafSchedules).toBe(2);
      expect(mountBefore.querySelectorAll(".gg-streaming-indicator")).toHaveLength(1);

      // When MessageContent later mounts into the row, MutationObserver relocates immediately
      const messageContent = document.createElement("div");
      messageContent.setAttribute("data-component", "MessageContent");
      messageContent.textContent = "Token 15";
      row.append(messageContent);
      await Promise.resolve();

      expect(mountBefore.querySelectorAll(".gg-streaming-indicator")).toHaveLength(0);
      expect(messageContent.nextElementSibling?.querySelector(".gg-streaming-indicator--after")).not.toBeNull();
      expect(rafQueue.size).toBe(0);
    } finally {
      controller.destroy();
    }
  });

  test("caps exponential backoff retries when MutationObserver is unavailable and does not reset on repeated MESSAGE_EDITED", () => {
    (globalThis as unknown as { MutationObserver: undefined }).MutationObserver = undefined;

    const rafQueue = new Map<number, FrameRequestCallback>();
    let nextRafId = 1;
    let totalRafSchedules = 0;
    (globalThis as unknown as { requestAnimationFrame: typeof requestAnimationFrame }).requestAnimationFrame = (
      cb: FrameRequestCallback,
    ) => {
      totalRafSchedules += 1;
      const id = nextRafId++;
      rafQueue.set(id, cb);
      return id;
    };
    (globalThis as unknown as { cancelAnimationFrame: typeof cancelAnimationFrame }).cancelAnimationFrame = (
      id: number,
    ) => {
      rafQueue.delete(id);
    };

    const origSetTimeout = globalThis.setTimeout;
    const origClearTimeout = globalThis.clearTimeout;
    const timerQueue = new Map<number, { cb: () => void; delay: number }>();
    const scheduledDelays: number[] = [];
    let nextTimerId = 1;
    (globalThis as unknown as { setTimeout: typeof setTimeout }).setTimeout = ((
      cb: () => void,
      delay = 0,
    ) => {
      const id = nextTimerId++;
      timerQueue.set(id, { cb, delay });
      scheduledDelays.push(delay);
      return id as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
    (globalThis as unknown as { clearTimeout: typeof clearTimeout }).clearTimeout = ((
      id: ReturnType<typeof setTimeout>,
    ) => {
      timerQueue.delete(id as unknown as number);
    }) as typeof clearTimeout;

    const flushRaf = () => {
      const entries = [...rafQueue.entries()];
      rafQueue.clear();
      for (const [, cb] of entries) cb(16);
    };
    const flushTimers = () => {
      const entries = [...timerQueue.entries()];
      timerQueue.clear();
      for (const [, entry] of entries) entry.cb();
    };

    const h = createHarness();
    const row = document.createElement("div");
    const mountBefore = document.createElement("span");
    mountBefore.setAttribute("data-spindle-mount", "message_body_before");
    row.append(mountBefore);
    document.body.append(row);
    h.rows.set("msg-1", row);

    const controller = new StreamingIndicatorController(h.ctx);
    try {
      controller.sync(makeRun({ hasContentOutput: false }));
      h.emit("MESSAGE_EDITED", {
        message: { id: "msg-1", content: "Chunk 1", swipe_id: 0 },
      });

      // Drain 2 fast RAF frames + all backoff timers while interleaving MESSAGE_EDITED
      for (let i = 0; i < 20; i += 1) {
        flushRaf();
        flushTimers();
        h.emit("MESSAGE_EDITED", {
          message: { id: "msg-1", content: `Chunk ${i + 2}`, swipe_id: 0 },
        });
      }

      // 2 fast RAF retries + 8 exponential backoff timers (capped at 500ms) -> stops permanently
      expect(totalRafSchedules).toBe(2);
      expect(scheduledDelays).toEqual([32, 64, 128, 256, 500, 500, 500, 500]);
      expect(rafQueue.size).toBe(0);
      expect(timerQueue.size).toBe(0);

      // Additional MESSAGE_EDITED events do NOT restart the retry loop
      for (let i = 0; i < 5; i += 1) {
        h.emit("MESSAGE_EDITED", {
          message: { id: "msg-1", content: `Late chunk ${i}`, swipe_id: 0 },
        });
      }
      expect(totalRafSchedules).toBe(2);
      expect(scheduledDelays).toHaveLength(8);
      expect(rafQueue.size).toBe(0);
      expect(timerQueue.size).toBe(0);
    } finally {
      controller.destroy();
      globalThis.setTimeout = origSetTimeout;
      globalThis.clearTimeout = origClearTimeout;
    }
  });

  test("does not mount optimistic indicator for foreground guided_swipe before messageId/swipeId confirmation, mounts once confirmed, and keeps optimistic row indicator for guided_continue", () => {
    const streamAfterMount = document.createElement("div");
    document.body.append(streamAfterMount);

    const h = createHarness("chat-1", {
      latestMessageId: "msg-1",
      streamAfterMount,
    });
    const row = document.createElement("div");
    const messageContent = document.createElement("div");
    messageContent.setAttribute("data-component", "MessageContent");
    messageContent.textContent = "Existing swipe content";
    row.append(messageContent);
    document.body.append(row);
    h.rows.set("msg-1", row);

    const controller = new StreamingIndicatorController(h.ctx);
    try {
      // 1. Pending foreground guided_swipe (no messageId/swipeId) mounts nothing on old swipe or streamAfter
      controller.sync({
        runId: "pending:1",
        actionId: "guided_swipe",
        chatId: "chat-1",
        startedAt: Date.now(),
      });
      expect(row.querySelectorAll(".gg-streaming-indicator")).toHaveLength(0);
      expect(streamAfterMount.querySelectorAll(".gg-streaming-indicator")).toHaveLength(0);

      // 2. Pre-dryRun backend status (still no messageId/swipeId) also mounts nothing
      controller.sync({
        runId: "run-swipe-1",
        actionId: "guided_swipe",
        chatId: "chat-1",
        startedAt: Date.now(),
        backgroundSwipe: false,
      });
      expect(row.querySelectorAll(".gg-streaming-indicator")).toHaveLength(0);
      expect(streamAfterMount.querySelectorAll(".gg-streaming-indicator")).toHaveLength(0);

      // 3. Confirmed messageId + swipeId mounts cleanly on the row
      controller.sync({
        runId: "run-swipe-1",
        actionId: "guided_swipe",
        chatId: "chat-1",
        startedAt: Date.now(),
        messageId: "msg-1",
        swipeId: 1,
        backgroundSwipe: false,
      });
      expect(row.querySelectorAll(".gg-streaming-indicator--after")).toHaveLength(1);
      expect(streamAfterMount.querySelectorAll(".gg-streaming-indicator")).toHaveLength(0);

      // Clear run
      controller.sync(null);
      expect(row.querySelectorAll(".gg-streaming-indicator")).toHaveLength(0);

      // 4. guided_continue without messageId still mounts optimistically on the latest row immediately
      controller.sync({
        runId: "pending:2",
        actionId: "guided_continue",
        chatId: "chat-1",
        startedAt: Date.now(),
      });
      expect(row.querySelectorAll(".gg-streaming-indicator--after")).toHaveLength(1);
      expect(streamAfterMount.querySelectorAll(".gg-streaming-indicator")).toHaveLength(0);
    } finally {
      controller.destroy();
    }
  });
});
