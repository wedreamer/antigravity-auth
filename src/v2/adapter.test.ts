import { describe, expect, it, vi } from "vitest";
import { setupV2, type V2Context } from "./adapter";

interface RegisteredTool {
  id?: string;
  description?: string;
  input?: unknown;
  execute?: () => Promise<unknown>;
}

interface RegisteredCommand {
  name?: string;
}

interface UpdatedModel {
  providerId: string;
  modelId: string;
  name?: string;
}

type DraftUpdater = (draft: Record<string, unknown>) => void;

type SessionHook = (event: {
  error?: { status?: number };
  decision?: unknown;
}) => Promise<void> | void;

describe("OpenCode v2 Adapter", () => {
  it(
    "initializes and registers tools, commands, models, and session hooks with OpenCode v2 context",
    async () => {
      const registeredTools: RegisteredTool[] = [];
      const registeredCommands: RegisteredCommand[] = [];
      const registeredHooks: Record<string, SessionHook> = {};
      const updatedModels: UpdatedModel[] = [];

      const mockContext: V2Context = {
        location: { directory: process.cwd() },
        session: {
          hook: vi.fn().mockImplementation(async (name: string, callback: SessionHook) => {
            registeredHooks[name] = callback;
            return { dispose: async () => undefined };
          }),
        },
        model: {
          transform: vi.fn().mockImplementation(async (callback: (editor: {
            update: (providerId: string, modelId: string, updater: DraftUpdater) => void;
          }) => void) => {
            const editor = {
              update: (providerId: string, modelId: string, updater: DraftUpdater) => {
                const draft: Record<string, unknown> = {};
                updater(draft);
                updatedModels.push({
                  providerId,
                  modelId,
                  name: typeof draft.name === "string" ? draft.name : undefined,
                });
              },
            };
            callback(editor);
            return { dispose: async () => undefined };
          }),
        },
        tool: {
          transform: vi.fn().mockImplementation(async (callback: (editor: {
            add: (tool: RegisteredTool) => void;
          }) => void) => {
            const editor = {
              add: (tool: RegisteredTool) => {
                registeredTools.push(tool);
              },
            };
            callback(editor);
            return { dispose: async () => undefined };
          }),
        },
        command: {
          transform: vi.fn().mockImplementation(async (callback: (editor: {
            add: (command: RegisteredCommand) => void;
          }) => void) => {
            const editor = {
              add: (command: RegisteredCommand) => {
                registeredCommands.push(command);
              },
            };
            callback(editor);
            return { dispose: async () => undefined };
          }),
        },
      };

      const cleanup = await setupV2(mockContext);
      expect(typeof cleanup).toBe("function");

      // Tools verification
      expect(mockContext.tool?.transform).toHaveBeenCalled();
      const quotaTool = registeredTools.find((t) => t.id === "antigravity_quota");
      expect(quotaTool).toBeDefined();
      expect(quotaTool?.description).toContain("Antigravity quota");

      const searchTool = registeredTools.find((t) => t.id === "google_search");
      expect(searchTool).toBeDefined();
      expect(searchTool?.description).toContain("Google Search");

      // Verify tools return structured content { content: ... }
      expect(quotaTool?.input).toBeDefined();
      expect(searchTool?.input).toBeDefined();
      if (!quotaTool?.execute) {
        throw new Error("quota tool execute was not registered");
      }
      const quotaResult = await quotaTool.execute();
      expect(quotaResult).toHaveProperty("content");

      // Command verification
      expect(mockContext.command?.transform).toHaveBeenCalled();
      const quotaCommand = registeredCommands.find((c) => c.name === "antigravity-quota");
      expect(quotaCommand).toBeDefined();

      // Model transform verification
      expect(mockContext.model?.transform).toHaveBeenCalled();
      const gemini38 = updatedModels.find((m) => m.modelId === "antigravity-gemini-3.8-flash");
      expect(gemini38).toBeDefined();
      expect(gemini38?.name).toContain("Gemini 3.8 Flash");

      // Session hooks verification
      expect(mockContext.session?.hook).toHaveBeenCalledWith("http.request", expect.any(Function));
      expect(mockContext.session?.hook).toHaveBeenCalledWith("http.response", expect.any(Function));
      expect(mockContext.session?.hook).toHaveBeenCalledWith("retry", expect.any(Function));

      // Test retry hook ignores non-429 errors
      const retryEvent: { error: { status: number }; decision?: unknown } = { error: { status: 500 } };
      const retryHook = registeredHooks["retry"];
      expect(retryHook).toBeDefined();
      if (!retryHook) {
        throw new Error("retry hook was not registered");
      }
      await retryHook(retryEvent);
      expect(retryEvent.decision).toBeUndefined();

      // Verify cleanup execution
      if (typeof cleanup === "function") {
        expect(() => cleanup()).not.toThrow();
      }
    },
    20000,
  );

  it("handles empty or partial v2 context gracefully", async () => {
    const emptyContext: V2Context = {};
    const cleanup = await setupV2(emptyContext);
    expect(typeof cleanup).toBe("function");
  });
});
