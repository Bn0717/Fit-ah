import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const code=ts.transpileModule(readFileSync(new URL('../app/fit-lab/xinAssets.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ES2020}}).outputText;
const {xinWalkAssets,XIN_WALK_DIR}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const legacy={js:'L',pantsFile:'L',pantsDir:'/models/fitlab/walk',packedPants:false,sk:'M_jL',shirtFile:'M_jL',shirtDir:'/models/fitlab/walk',packedShirt:false};
test('Xin uses a separate pants cache and compressed surface while retaining paired shirts',()=>{
 const next=xinWalkAssets(legacy,true);
 assert.equal(next.js,'xin-smooth/L');assert.equal(next.pantsDir,XIN_WALK_DIR);assert.equal(next.packedPants,true);
 for(const key of ['sk','shirtFile','shirtDir','packedShirt'])assert.equal(next[key],legacy[key]);
 assert.equal(legacy.packedPants,false,'compression must not alter the legacy layering decision');
});
test('uploaded photo swaps and other products retain their exact selection',()=>assert.equal(xinWalkAssets(legacy,false),legacy));
test('no pants never acquires an artificial Xin cache key',()=>{
 const bare={...legacy,js:null,pantsFile:null};assert.equal(xinWalkAssets(bare,true),bare);
});
