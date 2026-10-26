import type {ChatMessage} from "./chat-message-types";
import {probeImage} from "@/lib/media/image-probe";
/** Private files are derived only from validated inline pixels, never caller paths/URLs. */
export function codexImageInput(messages:ChatMessage[], home:string) {
 const images:Array<{path:string;base64:string}>=[];
 let bytes=0;
 const contents=messages.map(message=>typeof message.content==="string"?message.content:message.content.map(block=>{
  if(block.type!=="image_url")return block.type==="text"?block.text:JSON.stringify(block);
  const match=/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(block.image_url.url);
  if(!match||images.length>=4||match[2].length>6_000_000)throw new Error("Invalid image input: supply at most four bounded inline PNG/JPEG images");
  const buffer=Buffer.from(match[2],"base64"),probe=probeImage(buffer);
  bytes+=buffer.length;
  if(buffer.toString("base64")!==match[2]||bytes>4_000_000||probe.mimeType!==match[1]||!probe.width||!probe.height||probe.width*probe.height>40_000_000)
   throw new Error("Invalid image input: corrupt, mismatched or oversized pixels");
  const path=`${home}/image-${images.length+1}.${match[1]==="image/png"?"png":"jpg"}`;
  images.push({path,base64:match[2]});
  return `[Attached image ${images.length}]`;
 }).join("\n"));
 return {contents,images,args:images.flatMap(image=>["--image",image.path])};
}
