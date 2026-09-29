import { ANTIGRAVITY_DEFAULT_PROJECT_ID, readSharedRefresh } from "../../src/shared/index.ts";

export function resolveProjectId(storedRefresh: string, fallback: string = ANTIGRAVITY_DEFAULT_PROJECT_ID): string {
  const identity = readSharedRefresh(storedRefresh);
  return identity.projectId ?? identity.managedProjectId ?? fallback;
}
