/**
 * OpenCode v2 Plugin Adapter
 *
 * Provides native compatibility with the @opencode/plugin v2 specification
 * (OpenCode v2.0+) while sharing backend logic, accounts, and tools with v1.
 */
type V2Hook = (name: string, callback: (event: unknown) => Promise<void> | void, options?: unknown) => Promise<{
    dispose: () => Promise<void>;
}>;
type V2Transform = (callback: (editor: unknown) => void) => Promise<{
    dispose: () => Promise<void>;
}>;
export interface V2Context {
    readonly app?: unknown;
    readonly location?: {
        directory?: string;
    };
    readonly session?: {
        hook: V2Hook;
    };
    readonly model?: {
        transform: V2Transform;
    };
    readonly tool?: {
        transform: V2Transform;
    };
    readonly command?: {
        transform: V2Transform;
    };
    readonly provider?: {
        transform: V2Transform;
    };
    readonly integration?: {
        transform: V2Transform;
    };
}
export type CleanupFunction = () => Promise<void> | void;
/**
 * OpenCode v2 setup hook.
 * Called automatically by the v2 plugin supervisor during startup.
 */
export declare function setupV2(context: V2Context): Promise<CleanupFunction>;
export {};
//# sourceMappingURL=adapter.d.ts.map