// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {withMessages} from "@/test-support/with-messages";
import {ResponseFeedback} from "@/components/agent/ResponseFeedback";
import type {OperationsMapData} from "@/lib/ai-operations-map/load-map-data";
import {OperationsMapLiveShell} from "./OperationsMapLiveShell";
const actions=vi.hoisted(()=>({write:vi.fn()}));
vi.mock("next/navigation",()=>({useSearchParams:()=>new URLSearchParams(window.location.search)}));
vi.mock("@/lib/actions/response-feedback",()=>({recordResponseFeedbackAction:actions.write,getResponseFeedbackAction:vi.fn()}));
const state={messageId:"answer",available:true,unavailableReason:null,value:null,source:null,actorLabel:null,acceptedAt:null,revision:0,canWrite:true};
type RoutingSummary = {receipts:{attempts:{feedback:boolean|null}[]}[]};
vi.mock("./AiOperationsMap",()=>({
 AiOperationsMap:({routingManagement}:{routingManagement:RoutingSummary})=><>
  <output aria-label="Current routing feedback">{routingManagement.receipts[0].attempts[0].feedback===true?"Recorded kept":"No recorded feedback"}</output>
  <ResponseFeedback messageId="answer" eligible initialState={state}/>
 </>
}));
const start=Date.parse("2026-10-12T11:00:00Z"),end=Date.parse("2026-10-12T12:00:00Z");
const snapshot=(feedback:boolean|null)=>({queriedWindow:{start:new Date(start).toISOString(),end:new Date(end).toISOString()},routingManagement:{receipts:[{attempts:[{feedback}]}]}} as unknown as OperationsMapData);
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
beforeEach(()=>{vi.resetAllMocks();window.history.replaceState(null,"","/platform/ai/operations-map?routingWindow=60&routingProvider=cloud&routingTask=review&routingData=internal");});
describe("confirmed feedback refresh",()=>{
 it("refreshes the existing evidence snapshot immediately after saving, preserving the historical window and URL scope",async()=>{
  const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>snapshot(true)});vi.stubGlobal("fetch",fetcher);
  actions.write.mockResolvedValue({ok:true,data:{state:{...state,value:true,source:"human",revision:1},changed:true}});
  render(withMessages(<OperationsMapLiveShell initialData={snapshot(null)}/>));const url=window.location.href;
  const kept=screen.getByRole("button",{name:"Kept"});await waitFor(()=>expect(kept.getAttribute("aria-disabled")).toBe("false"));fireEvent.click(kept);
  await screen.findByText("Feedback saved.");await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));
  expect(fetcher.mock.calls[0][0]).toBe(`/api/platform/operations-map?start=${start}&end=${end}`);
  await screen.findByText("Recorded kept");expect(window.location.href).toBe(url);
 });
 it("does not refresh or claim a changed snapshot for an unknown failed save",async()=>{
  const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);actions.write.mockRejectedValue(new Error("lost connection"));
  render(withMessages(<OperationsMapLiveShell initialData={snapshot(null)}/>));const kept=screen.getByRole("button",{name:"Kept"});await waitFor(()=>expect(kept.getAttribute("aria-disabled")).toBe("false"));fireEvent.click(kept);
  await screen.findByText("Could not save. Check current feedback before trying again.");expect(fetcher).not.toHaveBeenCalled();expect(screen.getByText("No recorded feedback")).toBeTruthy();
 });
});
