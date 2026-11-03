import {describe,expect,it} from "vitest";
import {codexImageInput} from "./codex-image-input";
const png="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHNcAAAAASUVORK5CYII=";
const image={type:"image_url" as const,image_url:{url:`data:image/png;base64,${png}`}};
const home="/tmp/dpf-codex-auth-12345678-1234-1234-1234-123456789abc";
describe("Codex actual image input",()=>{
 it("separates exact pixels from archived text and produces private --image argv",()=>{
  const r=codexImageInput([{role:"user",content:[{type:"text",text:"Inspect default"},image]}],home);
  expect(r.contents).toEqual(["Inspect default\n[Attached image 1]"]);
  expect(r.images).toEqual([{path:`${home}/image-1.png`,base64:png}]);
  expect(r.args).toEqual(["--image",`${home}/image-1.png`]);
  expect(JSON.stringify(r.contents)).not.toContain(png);
 });
 it.each(["file:///tmp/local.png","https://example.com/image.png","data:image/jpeg;base64,"+png,"data:image/png;base64,broken"])("refuses unverified input %s",url=>{
  expect(()=>codexImageInput([{role:"user",content:[{...image,image_url:{url}}]}],home)).toThrow(/image input/i);
 });
 it("bounds image count before private staging",()=>{
  expect(()=>codexImageInput([{role:"user",content:Array(5).fill(image)}],home)).toThrow(/image input/i);
 });
 it("preserves ordinary text and tool content",()=>{
  expect(codexImageInput([{role:"user",content:"hello"}],home)).toEqual({contents:["hello"],images:[],args:[]});
 });
});
