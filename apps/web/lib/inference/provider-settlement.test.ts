import { describe, expect, it, vi } from "vitest";
import { captureProviderFetch, providerAttemptsSettled } from "./provider-settlement";

describe("request-bound provider settlement", () => {
  it("persists correlation before sending any provider bytes", async () => {
    const order: string[] = [];
    const fetchImpl = vi.fn(async () => { order.push("dispatch"); return new Response(JSON.stringify({id:"chat-1",choices:[{finish_reason:"stop"}]})); });
    const fetch = captureProviderFetch(fetchImpl as typeof globalThis.fetch, async event => { order.push(event.state); });
    await (await fetch("http://provider/v1/chat/completions", {method:"POST"})).text();
    expect(order).toEqual(["dispatching","dispatch","response-completed"]);
  });
  it("does not dispatch when the durable correlation write fails", async () => {
    const fetchImpl = vi.fn();
    const fetch = captureProviderFetch(fetchImpl, async () => { throw new Error("store unavailable"); });
    await expect(fetch("http://provider/v1/chat/completions", {method:"POST"})).rejects.toThrow("store unavailable");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("retains a client abort as unknown rather than provider cancellation", async () => {
    const events: any[] = [];
    const fetch = captureProviderFetch(vi.fn(async () => { throw new Error("aborted"); }) as typeof globalThis.fetch, async event => { events.push(event); });
    await expect(fetch("http://provider/v1/chat/completions", {method:"POST"})).rejects.toThrow("aborted");
    expect(events.map(e => e.state)).toEqual(["dispatching","client-ended"]);
    expect(providerAttemptsSettled(events)).toBe(false);
  });
  it("requires a complete terminal provider response, not headers or arbitrary EOF", async () => {
    const events: any[] = [];
    const fetch = captureProviderFetch(vi.fn(async () => new Response('{"error":"gateway timeout"}',{status:504})) as typeof globalThis.fetch, async event => { events.push(event); });
    const response = await fetch("http://provider/v1/chat/completions", {method:"POST"});
    expect(providerAttemptsSettled(events)).toBe(false);
    await response.text();
    expect(providerAttemptsSettled(events)).toBe(false);
  });
  it("requires every original attempt to settle, including failed fallback attempts", () => {
    expect(providerAttemptsSettled([{attemptId:"old",state:"dispatching"},{attemptId:"new",state:"dispatching"},{attemptId:"new",state:"response-completed"}])).toBe(false);
    expect(providerAttemptsSettled([])).toBe(false);
  });
  it("retains completion only after the body and its durable observation finish", async () => {
    const events: any[] = [];
    const fetch = captureProviderFetch(vi.fn(async () => new Response(JSON.stringify({id:"chat-original",choices:[{finish_reason:"length"}]}))) as typeof globalThis.fetch, async event => { events.push(event); });
    const response = await fetch("http://provider/v1/chat/completions", {method:"POST"});
    expect(events).toHaveLength(1);
    await response.text();
    expect(providerAttemptsSettled(events)).toBe(true);
    expect(events[1]).toMatchObject({state:"response-completed",providerRequestId:"chat-original"});
    expect(events[1]).not.toHaveProperty("body");
  });
});

it('does not accept an unrecognized provider finish reason as terminal proof', async () => {
  const events: any[] = [];
  const fetch = captureProviderFetch(vi.fn(async () => new Response(JSON.stringify({id:'chat-1',choices:[{finish_reason:'invented'}]}))) as typeof globalThis.fetch, async event => { events.push(event); });
  await (await fetch('http://provider/v1/chat/completions', {method:'POST'})).text();
  expect(providerAttemptsSettled(events)).toBe(false);
});

import { appendProviderSettlement, sealProviderSettlement, providerLedgerSettled } from './provider-settlement';
const binding = { taskNodeId: 'TN-1', requestDigest: 'a'.repeat(64), generation: 'original' };
it('refuses an unsealed attempt set and registration after sealing', () => {
  const identity = {providerId:'local',modelId:'model',traceId:'trace',accountMode:'local' as const};
  let ledger = appendProviderSettlement(null, {...identity,attemptId:'adapter-1',state:'adapter-registered'}, binding);
  ledger = appendProviderSettlement(ledger, {...identity,attemptId:'http-1',adapterAttemptId:'adapter-1',state:'dispatching'}, binding);
  ledger = appendProviderSettlement(ledger, {...identity,attemptId:'http-1',adapterAttemptId:'adapter-1',state:'response-completed',providerRequestId:'chat-1',responseDigest:'b'.repeat(64)}, binding);
  expect(providerLedgerSettled(ledger,binding)).toBe(false);
  ledger = sealProviderSettlement(ledger,binding);
  expect(providerLedgerSettled(ledger,binding)).toBe(true);
  expect(() => appendProviderSettlement(ledger,{attemptId:'fallback',state:'adapter-registered'},binding)).toThrow();
  expect(providerLedgerSettled(ledger,{...binding,generation:'other'})).toBe(false);
});
it('does not settle a sealed generation with an uncovered fallback adapter', () => {
  let ledger = appendProviderSettlement(null,{attemptId:'cli-unknown',state:'adapter-registered'},binding);
  expect(providerLedgerSettled(sealProviderSettlement(ledger,binding),binding)).toBe(false);
});

it('rejects oversized and duplicate settlement observations', () => {
  let ledger = appendProviderSettlement(null,{attemptId:'adapter',state:'adapter-registered'},binding);
  expect(() => appendProviderSettlement(ledger,{attemptId:'adapter',state:'adapter-registered'},binding)).toThrow();
  for (let i=0;i<63;i++) ledger=appendProviderSettlement(ledger,{attemptId:'request-'+i,adapterAttemptId:'adapter',state:'dispatching'},binding);
  expect(() => appendProviderSettlement(ledger,{attemptId:'overflow',state:'dispatching'},binding)).toThrow();
  expect(providerLedgerSettled(sealProviderSettlement(ledger,binding),binding)).toBe(false);
});

it('refuses missing provider identity in an otherwise sealed complete ledger', () => {
 let ledger=appendProviderSettlement(null,{attemptId:'adapter',state:'adapter-registered'},binding);
 ledger=appendProviderSettlement(ledger,{attemptId:'http',adapterAttemptId:'adapter',state:'dispatching'},binding);
 ledger=appendProviderSettlement(ledger,{attemptId:'http',adapterAttemptId:'adapter',state:'response-completed',providerRequestId:'id',responseDigest:'b'.repeat(64)},binding);
 expect(providerLedgerSettled(sealProviderSettlement(ledger,binding),binding)).toBe(false);
});

it('settles a sealed registered adapter only when no transport dispatch began', () => {
 const identity={providerId:'local',modelId:'model',traceId:'trace',accountMode:'local' as const};
 let ledger=appendProviderSettlement(null,{...identity,attemptId:'queued',state:'adapter-registered'},binding);
 ledger=appendProviderSettlement(ledger,{attemptId:'queued',state:'adapter-not-dispatched'},binding);
 expect(providerLedgerSettled(sealProviderSettlement(ledger,binding),binding)).toBe(true);
 ledger=appendProviderSettlement(ledger,{...identity,attemptId:'http',adapterAttemptId:'queued',state:'dispatching'},binding);
 expect(providerLedgerSettled(sealProviderSettlement(ledger,binding),binding)).toBe(false);
});
