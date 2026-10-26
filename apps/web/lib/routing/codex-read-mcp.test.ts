import {it,expect,vi,beforeEach} from "vitest";
import {codexReadMcpConfig} from "./codex-read-mcp";
const names=["read_source_at_version","wiki_query","search_ux_critique_corpus"];
const mintReadOnlySession=vi.fn(async()=>"private-token");
const session={userId:"human",agentId:"ux-design-critic",taskRunId:"TR-original",threadId:"thread",readOnlyToolNames:names,mintReadOnlySession,taskExecutionFence:{schemaVersion:1 as const,reservation:"reserved",dispatchClaim:"claim",authorityDigest:null,requestDigest:"a".repeat(64)}};
const tools=names.map(name=>({function:{name}}));
beforeEach(()=>vi.clearAllMocks());
it("fails closed on missing reader, added writer, task fence or attribution",async()=>{
 for(const patch of [{readOnlyToolNames:[...names,"create_backlog_item"]},{readOnlyToolNames:names.slice(1)},{taskExecutionFence:null},{taskRunId:null},{agentId:null}])await expect(codexReadMcpConfig({...session,...patch},tools,"http://portal:3000")).rejects.toThrow(/exact authorized/);
 await expect(codexReadMcpConfig(session,[...tools,{function:{name:"create_backlog_item"}}],"http://portal:3000")).rejects.toThrow(/exact authorized/);
 expect(mintReadOnlySession).not.toHaveBeenCalled();
});
it("uses only the execution layer's prebound session without routing-selected arguments",async()=>{
 const config=await codexReadMcpConfig(session,tools,"http://portal:3000/");
 expect(mintReadOnlySession).toHaveBeenCalledExactlyOnceWith();
 expect(config).toContain('private-token');expect(config).toContain('required = true');expect(config).toContain('http://portal:3000/api/mcp/v1?tier=full');
});
it("does not fall back to textual tools when session preparation fails",async()=>{
 mintReadOnlySession.mockRejectedValueOnce(new Error("session preparation unavailable"));
 await expect(codexReadMcpConfig(session,tools,"http://portal:3000")).rejects.toThrow("session preparation unavailable");
});
it("refuses native dispatch without an execution-layer minter",async()=>{
 await expect(codexReadMcpConfig({...session,mintReadOnlySession:undefined},tools,"http://portal:3000")).rejects.toThrow(/exact authorized/);
});
