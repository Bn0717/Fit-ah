import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const compile=code=>ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ES2020}}).outputText;
const url=code=>`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const engineUrl=url(compile(fs.readFileSync(path.join(root,'app/fit-lab/engine.ts'),'utf8')));
const engine=await import(engineUrl);
const sizingCode=compile(fs.readFileSync(path.join(root,'app/fit-lab/jeansFit.ts'),'utf8')).replaceAll("'./engine'",JSON.stringify(engineUrl)).replaceAll('"./engine"',JSON.stringify(engineUrl));
const {jeansState}=await import(url(sizingCode));
const meta=read('public/models/fitlab/grid/meta.json');
const sources=[{id:'xin',pants:meta.jeans}];
for(const product of read('public/models/fitlab/products/index.json').filter(p=>!p.hidden)){
 const p=read('public'+product.dir+'/product.json');
 sources.push({id:p.id,pants:{name:p.name,sizes:p.belt,belt:p.belt,drop:p.drop,elasticStretch:p.elastic_stretch}});
}
const endpointRows=[],summary=[],violations=[];let denseCases=0;
for(const {id,pants} of sources)for(const size of Object.keys(pants.sizes)){
 const elastic=!!pants.sizes[size].chart.elastic_waist;
 for(const belt of elastic?[false]:[false,true]){
  const result={style:id,size,mode:elastic?'elastic':belt?'belt':'drop',available:0,unavailable:0,denseAvailable:0,denseUnavailable:0};
  for(let h=meta.heights[0];h<=meta.heights.at(-1);h++)for(let c=meta.chests[0];c<=meta.chests.at(-1);c++){
   const state=jeansState(meta,pants,size,belt,h,c,null,null,0);denseCases++;
   if(!state)throw Error('Missing state '+id+size);
   result[state.hide?'denseUnavailable':'denseAvailable']++;
   if(state.qualityIssues.length&&!state.hide)violations.push({id,size,h,c,error:'Failed corner shown'});
   if(!state.hide&&elastic&&state.now.bodyWaist<state.now.relaxedWaist-4)violations.push({id,size,h,c,error:'Loose elastic falsely held at natural waist'});
   if(!state.hide&&!elastic&&state.now.waistEase<0&&/Too big|Loose|Slides/.test(state.now.label))violations.push({id,size,h,c,error:'Undersized labelled loose'});
   if(!state.hide&&state.now.lengthFit==='pooling'&&state.now.hem>.5)violations.push({id,size,h,c,error:'False pooling'});
   if(meta.heights.includes(h)&&meta.chests.includes(c)){
    result[state.hide?'unavailable':'available']++;
    endpointRows.push({style:id,size,mode:result.mode,height:h,chest:c,available:!state.hide,label:state.now?.label??state.reason,reason:state.reason,waistEase:state.now?.waistEase,elasticExtension:state.now?.elasticExtension,quality:state.qualityIssues.join('; ')});
   }
  }
  summary.push(result);
 }
}
const report={summary,denseCases,endpointCases:endpointRows.length,violations,endpointRows};
const out=path.join(root,'docs/audits');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'fit-grid-quality-2026-10-20.json'),JSON.stringify(report,null,2)+'\n');
const columns=['style','size','mode','height','chest','available','label','reason','waistEase','elasticExtension','quality'];
fs.writeFileSync(path.join(out,'fit-grid-quality-2026-10-20.csv'),[columns.join(','),...endpointRows.map(row=>columns.map(c=>JSON.stringify(row[c]??'')).join(','))].join('\n')+'\n');
console.table(summary);console.log(JSON.stringify({denseCases,endpointCases:endpointRows.length,violations:violations.length}));
if(violations.length)process.exitCode=1;
