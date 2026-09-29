export interface AssistantMessageEventStreamLike {
  push(event: unknown): void;
  end(result?: unknown): void;
  fail(error: unknown): void;
}

/**
 * senpi aliases @earendil-works/pi-ai to its bundled runtime when it loads an extension
 * (dist/core/extensions/loader.js). Vitest has no such loader, so tests get this stand-in: it
 * records the events the extension pushes, which is exactly what the assertions inspect. The
 * methods mirror the host contract (push/end/fail) so a failure path that the host supports cannot
 * go unguarded here.
 */
export function createAssistantMessageEventStream(): AssistantMessageEventStreamLike & { events: unknown[]; failures: unknown[] } {
  const events: unknown[] = [];
  const failures: unknown[] = [];
  return {
    events,
    failures,
    push(event: unknown) {
      events.push(event);
    },
    end() {},
    fail(error: unknown) {
      failures.push(error);
    },
  };
}
