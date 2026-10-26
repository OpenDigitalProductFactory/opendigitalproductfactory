import {it,expect,vi} from "vitest";
vi.mock("@/lib/mcp/session-token",()=>({createMcpSessionToken:vi.fn().mockResolvedValue("private-token")}));
import {codexReadMcpConfig} from "./codex-read-mcp";
import {createMcpSessionToken} from "@/lib/mcp/session-token";
const names=["read_source_at_version","wiki_query","search_ux_critique_corpus"];
const session={userId:"human",agentId:"ux-design-critic",taskRunId:"TR-original",threadId:"thread",readOnlyToolNames:names,taskExecutionFence:{schemaVersion:1 as const,reservation:"reserved",dispatchClaim:"claim",authorityDigest:null,requestDigest:"a".repeat(64)}};
const tools=names.map(name=>({function:{name}}));
it("fails closed on missing reader, added writer, task fence or attribution",async()=>{
 for(const patch of [{readOnlyToolNames:[...names,"create_backlog_item"]},{readOnlyToolNames:names.slice(1)},{taskExecutionFence:null},{taskRunId:null},{agentId:null}])await expect(codexReadMcpConfig({...session,...patch},tools,"http://portal:3000")).rejects.toThrow(/exact authorized/);
 await expect(codexReadMcpConfig(session,[...tools,{function:{name:"create_backlog_item"}}],"http://portal:3000")).rejects.toThrow(/exact authorized/);
 expect(createMcpSessionToken).not.toHaveBeenCalled();
});
it("uses the same identity and fence with existing read scopes only",async()=>{
 const config=await codexReadMcpConfig(session,tools,"http://portal:3000/");
 expect(createMcpSessionToken).toHaveBeenCalledWith({...session,scopes:["file_read","registry_read"],capability:"read"});
 expect(config).not.toContain("backlog_read");expect(config).toContain('required = true');expect(config).toContain('http://portal:3000/api/mcp/v1?tier=full');
});
it("does not fall back to textual tools when session preparation fails",async()=>{
 vi.mocked(createMcpSessionToken).mockRejectedValueOnce(new Error("session preparation unavailable"));
 await expect(codexReadMcpConfig(session,tools,"http://portal:3000")).rejects.toThrow("session preparation unavailable");
});
