declare module "@earendil-works/pi-ai/compat" {
  export interface AssistantMessageEventStreamLike {
    push(event: unknown): void;
    end(result?: unknown): void;
    fail(error: unknown): void;
  }

  export function createAssistantMessageEventStream(): AssistantMessageEventStreamLike;
}

declare module "@earendil-works/pi-coding-agent" {
  export interface ExtensionAPI {
    registerProvider(id: string, config: Record<string, unknown>): void;
  }
}
