export interface StickyState {
  bindings: Map<string, string>
  cursor: number
}

export function createStickyState(): StickyState {
  return { bindings: new Map(), cursor: 0 }
}

export function pickStickyAccount<T extends { id: string }>(
  state: StickyState,
  sessionKey: string,
  available: readonly T[],
): T | null {
  if (available.length === 0) return null
  const key = sessionKey || "default"
  const boundId = state.bindings.get(key)
  const bound = available.find((account) => account.id === boundId)
  if (bound) return bound
  const picked = available[state.cursor % available.length]
  if (!picked) return null
  state.cursor += 1
  state.bindings.set(key, picked.id)
  return picked
}

export function clearStickyBinding(state: StickyState, sessionKey: string): void {
  state.bindings.delete(sessionKey || "default")
}
