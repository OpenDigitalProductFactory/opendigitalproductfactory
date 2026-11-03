// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { withMessages } from "@/test-support/with-messages";
import { ResponseFeedback } from "./ResponseFeedback";
const actions = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock("@/lib/actions/response-feedback", () => ({ getResponseFeedbackAction: actions.read, recordResponseFeedbackAction: actions.write }));
const state = { messageId: "answer", available: true, unavailableReason: null, value: null, source: null, actorLabel: null, acceptedAt: null, revision: 0, canWrite: true };
const mount = (eligible = true) => render(withMessages(<ResponseFeedback messageId="answer" eligible={eligible}/>));
afterEach(cleanup);
beforeEach(() => { vi.resetAllMocks(); actions.read.mockResolvedValue({ ok: true, data: state }); });
describe("exact-response feedback control", () => {
  it("does not fetch or offer writes for an unbound legacy answer", () => {
    mount(false);
    expect(screen.getByText("Feedback unavailable for this answer.")).toBeTruthy();
    expect(actions.read).not.toHaveBeenCalled(); expect(actions.write).not.toHaveBeenCalled();
  });
  it("saves one explicit choice and its revision, then keeps clear and correction available", async () => {
    actions.write.mockResolvedValue({ ok: true, data: { state: { ...state, value: true, source: "human", actorLabel: "Mark", revision: 1 }, changed: true } });
    mount(); const kept = await screen.findByRole("button", { name: "Kept" });
    await waitFor(() => expect(kept.getAttribute("aria-disabled")).toBe("false"));
    kept.focus(); fireEvent.click(kept);
    await screen.findByText("Feedback saved.");
    expect(actions.write).toHaveBeenCalledExactlyOnceWith({ messageId: "answer", value: true, expectedRevision: 0 });
    expect(kept.getAttribute("aria-pressed")).toBe("true"); expect(document.activeElement).toBe(kept);
    expect(screen.getByText("Human feedback")).toBeTruthy();
    actions.write.mockResolvedValue({ ok: true, data: { state: { ...state, value: false, source: "human", revision: 2 }, changed: true } });
    fireEvent.click(screen.getByRole("button", { name: "Needs revision" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Needs revision" }).getAttribute("aria-pressed")).toBe("true"));
    expect(actions.write).toHaveBeenLastCalledWith({ messageId: "answer", value: false, expectedRevision: 1 });
    actions.write.mockResolvedValue({ ok: true, data: { state: { ...state, revision: 3 }, changed: true } });
    const clear = screen.getByRole("button", { name: "Clear feedback" }); clear.focus(); fireEvent.click(clear);
    await screen.findByText("Feedback cleared."); expect(document.activeElement).toBe(clear);
    expect(actions.write).toHaveBeenLastCalledWith({ messageId: "answer", value: null, expectedRevision: 2 });
  });
  it("blocks duplicate dispatch while pending and announces status", async () => {
    let finish!: (value: unknown) => void; actions.write.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    mount(); const kept = await screen.findByRole("button", { name: "Kept" });
    await waitFor(() => expect(kept.getAttribute("aria-disabled")).toBe("false"));
    fireEvent.click(kept); fireEvent.click(kept); expect(actions.write).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").textContent).toBe("Saving feedback…");
    finish({ ok: true, data: { state: { ...state, value: true, source: "human", revision: 1 }, changed: true } });
    await screen.findByText("Feedback saved.");
  });
  it("reconciles a conflict without silently retrying the write", async () => {
    actions.write.mockResolvedValue({ ok: false, error: "conflict" });
    actions.read.mockResolvedValueOnce({ ok: true, data: state }).mockResolvedValue({ ok: true, data: { ...state, value: false, source: "agent", revision: 2 } });
    mount(); const kept=await screen.findByRole("button", { name:"Kept" });
    await waitFor(() => expect(kept.getAttribute("aria-disabled")).toBe("false")); fireEvent.click(kept);
    await screen.findByText("Feedback changed. Review the current choice before saving again.");
    expect(actions.write).toHaveBeenCalledTimes(1); expect(screen.getByText("Agent feedback")).toBeTruthy();
    expect(screen.getByRole("button", {name:"Needs revision"}).getAttribute("aria-pressed")).toBe("true");
  });
  it("does not report an unknown save as successful; retry reads current state", async () => {
    actions.write.mockRejectedValue(new Error("connection lost")); mount();
    const kept=await screen.findByRole("button", {name:"Kept"}); await waitFor(() => expect(kept.getAttribute("aria-disabled")).toBe("false")); fireEvent.click(kept);
    await screen.findByText("Could not save. Check current feedback before trying again.");
    actions.read.mockResolvedValue({ok:true,data:{...state,value:true,source:"human",revision:1}});
    fireEvent.click(screen.getByRole("button", {name:"Check again"}));
    await waitFor(() => expect(kept.getAttribute("aria-pressed")).toBe("true"));
    expect(actions.write).toHaveBeenCalledTimes(1); expect(document.activeElement).toBe(kept);
  });
  it("keeps unavailable or unauthorized feedback read-only", async () => {
    actions.read.mockResolvedValue({ok:true,data:{...state,available:false,canWrite:false,unavailableReason:"missing-attempt"}}); mount();
    await screen.findByText("Feedback unavailable for this answer."); fireEvent.click(screen.getByRole("button",{name:"Kept"})); expect(actions.write).not.toHaveBeenCalled();
  });
});


it("reuses authorized answer state without an extra read and keeps the captured revision",async()=>{
 actions.write.mockResolvedValue({ok:true,data:{state:{...state,value:true,source:"human",revision:5},changed:true}});
 render(withMessages(<ResponseFeedback messageId="answer" eligible initialState={{...state,revision:4}}/>));
 const kept=screen.getByRole("button",{name:"Kept"});await waitFor(()=>expect(kept.getAttribute("aria-disabled")).toBe("false"));
 expect(actions.read).not.toHaveBeenCalled();fireEvent.click(kept);await screen.findByText("Feedback saved.");
 expect(actions.write).toHaveBeenCalledExactlyOnceWith({messageId:"answer",value:true,expectedRevision:4});
});


it.each(["agent",null] as const)("records an explicit human confirmation even when the %s choice already matches",async source=>{
 actions.read.mockResolvedValue({ok:true,data:{...state,value:true,source,actorLabel:source?"Coworker":null,revision:4}});
 actions.write.mockResolvedValue({ok:true,data:{state:{...state,value:true,source:"human",actorLabel:"Owner",revision:5},changed:true}});
 mount();const kept=await screen.findByRole("button",{name:"Kept"});await waitFor(()=>expect(kept.getAttribute("aria-disabled")).toBe("false"));
 if(source===null)expect(screen.getByText("Unattributed feedback")).toBeTruthy();
 fireEvent.click(kept);await waitFor(()=>expect(actions.write).toHaveBeenCalledExactlyOnceWith({messageId:"answer",value:true,expectedRevision:4}));
 await screen.findByText("Human feedback");
});


it("does not submit an empty clear when that control advertises disabled",async()=>{
 mount();const clear=await screen.findByRole("button",{name:"Clear feedback"});await waitFor(()=>expect(screen.getByRole("button",{name:"Kept"}).getAttribute("aria-disabled")).toBe("false"));
 expect(clear.getAttribute("aria-disabled")).toBe("true");fireEvent.click(clear);expect(actions.write).not.toHaveBeenCalled();
});
it("allows an explicit availability recheck when asynchronous telemetry has not arrived yet",async()=>{
 actions.read.mockResolvedValueOnce({ok:true,data:{...state,available:false,canWrite:false,unavailableReason:"unavailable"}}).mockResolvedValue({ok:true,data:state});
 mount();await screen.findByText("Feedback unavailable for this answer.");fireEvent.click(screen.getByRole("button",{name:"Check again"}));
 await waitFor(()=>expect(screen.getByRole("button",{name:"Kept"}).getAttribute("aria-disabled")).toBe("false"));expect(actions.read).toHaveBeenCalledTimes(2);expect(actions.write).not.toHaveBeenCalled();
});
