import { describe, expect, it } from "vitest"

import { clearStickyBinding, createStickyState, pickStickyAccount } from "./affinity.ts"

const accounts = [{ id: "a" }, { id: "b" }, { id: "c" }]

describe("sticky account binding", () => {
  it("assigns new sessions across accounts and keeps a session on the same account", () => {
    const state = createStickyState()
    const first = pickStickyAccount(state, "chat-1", accounts)
    const again = pickStickyAccount(state, "chat-1", accounts)
    const second = pickStickyAccount(state, "chat-2", accounts)
    const third = pickStickyAccount(state, "chat-3", accounts)

    expect(first?.id).toBe("a")
    expect(again?.id).toBe("a")
    expect(second?.id).toBe("b")
    expect(third?.id).toBe("c")
  })

  it("rebinds a session after its account leaves the available set", () => {
    const state = createStickyState()
    expect(pickStickyAccount(state, "chat-1", accounts)?.id).toBe("a")
    clearStickyBinding(state, "chat-1")
    const rebound = pickStickyAccount(state, "chat-1", accounts.filter((account) => account.id !== "a"))
    expect(rebound?.id).toBe("c")
    expect(pickStickyAccount(state, "chat-1", accounts.filter((account) => account.id !== "a"))?.id).toBe("c")
  })
})
