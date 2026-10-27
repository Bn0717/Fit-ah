/** Snapshot existing UI availability for the render-only asset builder; changes no fit policy. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const compile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ES2020}}).outputText;
const moduleUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const engine=moduleUrl(compile(fs.readFileSync(path.join(root,'app/fit-lab/engine.ts'),'utf8')));
const source=compile(fs.readFileSync(path.join(root,'app/fit-lab/jeansFit.ts'),'utf8')).replaceAll("'./engine'",JSON.stringify(engine));
const {jeansState}=await import(moduleUrl(source));
const meta=JSON.parse(fs.readFileSync(path.join(root,'public/models/fitlab/bodies/grid/meta.json'))),result={};
for(const mode of ['drop','belt'])for(const size of ['M','L','XL','2XL']){
 const cases={};
 for(const h of meta.heights)for(const c of meta.chests){
  const state=jeansState(meta,meta.jeans,size,mode==='belt',h,c,null,null,0);
  cases[`h${h}_c${c}`]={hide:state.hide,reason:state.reason};
 }
 result[`${size}-${mode}`]=cases;
}
const out=path.join(root,'output/xin-surface');fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'availability.json'),JSON.stringify(result,null,2)+'\n');
console.log('Recorded existing Xin availability; no fit rules changed.');
