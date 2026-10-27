// Local publication build only. Uses the discovered bundled runtime; adds no DPF dependency.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.resolve(process.argv[2] ?? path.join(sourceDir, '.build'));
const skillDir = process.argv[3];
const modules = process.env.ARTIFACT_NODE_MODULES;
const python = process.env.ARTIFACT_PYTHON;
process.env.RUNTIME_NODE_MODULES ??= modules;
if (!skillDir || !modules || !python) throw new Error('Supply build directory, presentation skill directory, ARTIFACT_NODE_MODULES and ARTIFACT_PYTHON');
const requireRuntime = createRequire(path.join(modules, '_publication-loader.cjs'));
const { Presentation, PresentationFile } = await import(pathToFileURL(requireRuntime.resolve('@oai/artifact-tool')).href);
const { finalizePresentation } = await import(pathToFileURL(path.join(skillDir, 'container_tools/artifact_tool_utils.mjs')).href);
await fs.mkdir(buildDir, { recursive: true });
const finalDir = path.join(buildDir, 'final');
await fs.mkdir(finalDir, { recursive: true });
const outline = JSON.parse(await fs.readFile(path.join(sourceDir, 'deck-outline.json'), 'utf8'));
const pres = Presentation.create({ slideSize: { width: 1280, height: 720 } });
const color = { ink: '#17283B', body: '#344960', accent: '#0A766E', pale: '#F0F5F7', rule: '#CAD6DD' };
const FONT = 'Arial';
pres.theme.defaultFont = FONT;
function text(slide, value, x, y, w, h, size, opts = {}) {
  const shape = slide.shapes.add({ geometry:'textbox', name:opts.name ?? value.slice(0,40), position:{left:x,top:y,width:w,height:h}, fill:opts.fill ?? 'none', line:{fill:'none',width:0} });
  shape.text = value;
  shape.text.style = { typeface:FONT, fontSize:size, color:opts.color ?? color.body, bold:opts.bold ?? false, alignment:opts.alignment ?? 'left' };
  shape.text.insets = 0;
  return shape;
}
for (const [i, spec] of outline.slides.entries()) {
  const slide = pres.slides.add(); slide.background.fill = '#FFFFFF';
  slide.speakerNotes.text = spec.notes;
  if (spec.cover) {
    text(slide,spec.title,72,155,1100,180,76,{bold:true,color:color.ink});
    text(slide,spec.subtitle,74,360,1080,70,38,{color:color.accent});
    text(slide,spec.body.join('\n'),74,500,1080,110,28);
  } else {
    text(slide,spec.title,64,52,1152,95,52,{bold:true,color:color.ink});
    if(spec.table) {
      const rows=spec.table.length, height=rows*70;
      const table=slide.tables.add({rows,columns:2,left:64,top:195,width:1152,height,columnWidths:[400,752],values:spec.table});
      for(let r=0;r<rows;r++) for(let c=0;c<2;c++) {
        const cell=table.getCell(r,c); cell.fill=r===0?color.ink:(r%2===0?'#FFFFFF':color.pale);
        cell.text.style={typeface:FONT,fontSize:27,bold:r===0,color:r===0?'#FFFFFF':color.body};
      }
      table.borders.assign({style:'solid',fill:color.rule,width:1});
    } else if(spec.diagram) {
      const positions=[[64,210],[480,210],[896,210],[896,390],[480,390],[64,390]];
      const nodes=spec.diagram.map((label,n)=>{
        const [x,y]=positions[n];
        const shape=slide.shapes.add({geometry:'rect',name:label,position:{left:x,top:y,width:280,height:100},fill:color.pale,line:{style:'solid',fill:color.accent,width:2}});
        shape.text=label; shape.text.style={typeface:FONT,fontSize:29,bold:true,color:color.ink,alignment:'center'}; shape.text.insets=18;
        return shape;
      });
      for(let n=0;n<5;n++) slide.shapes.connect(nodes[n],nodes[n+1],{kind:'straight',fromSide:n===2?'bottom':(n<2?'right':'left'),toSide:n===2?'top':(n<2?'left':'right'),line:{fill:color.accent,width:3},tail:{type:'triangle',width:'med',length:'med'}});
      text(slide,spec.body.join('\n'),64,550,1152,100,29);
    } else {
      spec.body.forEach((line,n)=>text(slide,line,76,205+n*76,1110,65,33));
    }
    if(spec.disclosure)text(slide,spec.disclosure,64,620,1152,42,24,{bold:true,color:color.accent});
  }
  text(slide,'Discussion draft · 16 Oct 2026',64,680,800,24,17,{color:'#607485'});
  text(slide,String(i+1).padStart(2,'0'),1136,680,80,24,17,{color:'#607485',alignment:'right'});
}
const candidate=path.join(buildDir,'candidate.pptx');
await (await PresentationFile.exportPptx(pres)).save(candidate);
const finalPath=path.join(finalDir,'trusted-agent-tbm.pptx');
const result=await finalizePresentation({workspaceDir:buildDir,candidatePath:candidate,finalPath,pythonExecutable:python,integrityValidatorPath:path.join(skillDir,'container_tools/inspect_presentation_package_integrity.py'),layoutValidatorPath:path.join(skillDir,'container_tools/inspect_presentation_layout_geometry.py'),layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-bullet-geometry','--validate-heading-fit',...[3,6,8,11].flatMap(n=>['--require-native-table-slide',String(n)])],explicitTotalSlideCount:outline.slides.length,requiredNativeTableOwnerSlides:[3,6,8,11],requiredNativeChartOwnerSlides:[],fontPolicy:{basis:'design',families:[FONT]},verifyArtifactToolImport:true,receiptPath:path.join(buildDir,'validation.json')});
console.log(JSON.stringify(result));
const previewDir=path.join(finalDir,'previews'); await fs.mkdir(previewDir,{recursive:true});
for(const [i,slide] of pres.slides.items.entries()) {
  const blob=await pres.export({slide,format:'png',scale:1});
  await fs.writeFile(path.join(previewDir,`slide-${String(i+1).padStart(2,'0')}.png`),new Uint8Array(await blob.arrayBuffer()));
}
const montage=await pres.export({format:'webp',montage:true});
await fs.writeFile(path.join(finalDir,'deck-montage.webp'),new Uint8Array(await montage.arrayBuffer()));
console.log(`Exported ${outline.slides.length} slides and previews to ${finalDir}`);
