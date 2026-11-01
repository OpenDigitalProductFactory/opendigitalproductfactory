// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {withMessages} from "@/test-support/with-messages";
import {RoutingResponseReview} from "./RoutingResponseReview";
const actions=vi.hoisted(()=>({read:vi.fn()}));
vi.mock("@/lib/actions/response-feedback",()=>({getResponseFeedbackAnswerAction:actions.read}));
vi.mock("@/components/agent/ResponseFeedback",()=>({ResponseFeedback:()=> <div data-testid="feedback-control"/>}));
const result=(content:string)=>({ok:true,data:{content,attemptId:"attempt",providerId:"provider",modelId:"model",state:{messageId:"answer",available:true,canWrite:true,value:null,source:null,revision:0}}});
afterEach(cleanup);beforeEach(()=>vi.resetAllMocks());
describe("authorized saved-answer review",()=>{
 it("shows only the current authorized answer and keeps one read per request",async()=>{
  actions.read.mockResolvedValue(result("Authorized **answer**."));const back=vi.fn();render(withMessages(<RoutingResponseReview messageId="answer" expectedAttemptId="attempt" onBack={back}/>));
  await screen.findByText("answer");expect(actions.read).toHaveBeenCalledExactlyOnceWith("answer","attempt");expect(screen.getByTestId("feedback-control")).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Back to decision"}));expect(back).toHaveBeenCalledTimes(1);
 });
 it("ignores an older response after changing the message locator",async()=>{
  let finish!:(value:unknown)=>void;actions.read.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValue(result("Current answer."));
  const view=render(withMessages(<RoutingResponseReview messageId="old" expectedAttemptId="old-attempt" onBack={()=>{}}/>));view.rerender(withMessages(<RoutingResponseReview messageId="answer" expectedAttemptId="attempt" onBack={()=>{}}/>));
  await screen.findByText("Current answer.");finish(result("Old private answer."));await waitFor(()=>expect(screen.queryByText("Old private answer.")).toBeNull());
 });
 it("exposes no answer on failure and preserves stable focus while checking again",async()=>{
  actions.read.mockResolvedValueOnce({ok:false,error:"forbidden"}).mockResolvedValue(result("Recovered answer."));render(withMessages(<RoutingResponseReview messageId="answer" expectedAttemptId="attempt" onBack={()=>{}}/>));
  await screen.findByText("This saved answer is unavailable with your current access or evidence.");expect(screen.queryByTestId("feedback-control")).toBeNull();
  const retry=screen.getByRole("button",{name:"Check answer again"});retry.focus();fireEvent.click(retry);await screen.findByText("Recovered answer.");
  expect(document.activeElement).toBe(screen.getByRole("button",{name:"Back to decision"}));expect(actions.read).toHaveBeenCalledTimes(2);
 });
});
