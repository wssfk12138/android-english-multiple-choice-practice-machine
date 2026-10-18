import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {mkdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {server} from './helpers/daily-study-browser-fixture.mjs'
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright')
const output=process.env.DAILY_STUDY_OUTPUT
if(output)await mkdir(output,{recursive:true})
const sentence='Researchers compare available evidence before drawing a conclusion. '
const base={term:'evidence',phonetic:'/synthetic/',part_of_speech:'n.',common_meaning:'证据；根据',contextual_meaning:'上下文中的判断依据',latest_sentence:sentence,occurrences:[{year:2026,unit_title:'Synthetic source'}],generated_example:{sentence:'Evidence supports the conclusion.',translation:'证据支持这个结论。'},note:'既有笔记。',memory_hint:'联系上下文记忆。',morphology:{currentForm:'名词',forms:[{label:'复数',word:'evidences'}],note:'词形说明。'},synonyms:[{word:'proof',note:'可核验的证明。'}],antonyms:[{word:'guess',note:'缺乏依据的猜测。'}],similar_forms:[],local_similar:[{word:'evident',note:'本地形近词辨析。'}]}
const copy=value=>structuredClone(value)
const synthetic=[
 {label:'ordinary',entry:copy(base)},
 {label:'consequently',entry:{...copy(base),term:'Consequently',common_meaning:'因此；所以'}},
 {label:'long bilingual',entry:{...copy(base),generated_example:{sentence:sentence.repeat(24),translation:'长译文完整呈现并可以到达末尾。'.repeat(50)}}},
 {label:'long hint',entry:{...copy(base),memory_hint:'记忆提示以连续两栏完整阅读，结合语境与词形反复比较。\n'.repeat(100)}},
 {label:'rich',entry:{...copy(base),note:'丰富笔记完整阅读。\n'.repeat(80),synonyms:Array.from({length:18},(_,i)=>({word:'synonym'+i,note:'长辨析说明完整保留。'.repeat(12)}))}},
 {label:'meaning only',entry:{term:'plain',common_meaning:'简短释义'}},
 {label:'long word and string',entry:{...copy(base),term:'pneumonoultramicroscopicsilicovolcanoconiosis',note:'continuous'.repeat(200)}}
]
const samples=process.env.DAILY_STUDY_SAMPLES?(await import(pathToFileURL(process.env.DAILY_STUDY_SAMPLES))).samples:synthetic
samples.push({label:'all extreme',entry:{...copy(base),common_meaning:'长释义完整保留。'.repeat(100),contextual_meaning:'长语境完整保留。'.repeat(100),latest_sentence:sentence.repeat(100),generated_example:{sentence:sentence.repeat(100),translation:'长译文完整保留。'.repeat(200)},memory_hint:'长提示完整保留。'.repeat(300),note:'长笔记完整保留。'.repeat(300),synonyms:Array.from({length:25},(_,i)=>({word:'synonym'+i,note:'长辨析完整保留。'.repeat(100)}))}})
samples.push({label:'edge fields',entry:{term:'edge',generated_example:{translation:'仅译文仍保留。'},morphology:{forms:[{label:'复数',word:'edge-forms'}],note:'只有词形说明。'},local_similar:[{word:'local-only',note:'本地内容。'}]}})
const order=['memory_hint','common_meaning','contextual','source_sentence','model_sentence','note','morphology','similar_forms','synonyms','antonyms']
let browser
const rows=[],errors=[]
export function measureColumns(el) {
 if(!el)return null
 const b=el.getBoundingClientRect(),count=Number(getComputedStyle(el).columnCount)||1,bottoms=Array(count).fill(null),outside=[]
 let maxLine=0,n;const walk=document.createTreeWalker(el,NodeFilter.SHOW_TEXT)
 while(n=walk.nextNode()){
  if(!n.textContent.trim())continue
  const style=getComputedStyle(n.parentElement),range=document.createRange();range.selectNodeContents(n)
  for(const r of range.getClientRects()){
   if(r.width<.1||r.height<.1)continue
   const col=count===1?0:r.x>=b.x+b.width/2?1:0
   bottoms[col]=Math.max(bottoms[col]||0,r.bottom-b.top)
   maxLine=Math.max(maxLine,parseFloat(style.lineHeight)||r.height)
   if(r.left<b.left-2||r.right>b.right+2)outside.push(n.textContent.slice(0,15))
  }
 }
 const applicable=count===2&&bottoms.every(x=>x!==null)
 return {count,bottoms,difference:applicable?Math.abs(bottoms[0]-bottoms[1]):null,maxLine,applicable,outside}
}
try{
 await server.listen();browser=await chromium.launch({headless:true})
 const page=await browser.newPage({viewport:{width:1205,height:728}})
 page.on('pageerror',e=>errors.push(e.message))
 await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/__daily-study')
 await page.locator('.daily-study-entry').click();await page.locator('.study-scroll[data-identity]').waitFor()
 const matrix=[[1205,728,1,false],[960,600,1.5,false],[1440,850,1.25,false],[960,600,1.5,true],[750,500,1,false],[730,500,1,false],[844,390,1,false],[960,600,2,false]]
 for(const [width,height,scale,dark] of matrix){
  await page.setViewportSize({width,height});await page.evaluate(({scale,dark})=>{document.documentElement.style.fontSize=16*scale+'px';document.documentElement.classList.toggle('dark',dark)},{scale,dark})
  for(let i=0;i<samples.length;i++){
   const entry=samples[i].entry
   await page.evaluate(entry=>{globalThis.detailOverride={common_meaning:'',contextual_meaning:'',latest_sentence:'',generated_example:null,phonetic:'',part_of_speech:'',note:'',memory_hint:'',morphology:null,synonyms:[],antonyms:[],similar_forms:[],local_similar:[],occurrences:[],...entry,id:1};globalThis.revision++;document.dispatchEvent(new Event('visibilitychange'))},entry)
   await page.waitForFunction(()=>globalThis.detailReadRevision===globalThis.revision)
   await page.waitForFunction(term=>document.querySelector('.word-heading h1')?.textContent===term,entry.term)
   await page.waitForFunction(()=>document.querySelector('.study-card')?.getAttribute('aria-busy')==='false')
   await page.evaluate(()=>document.fonts.ready)
   await page.locator('.study-scroll[data-identity]').evaluate(el=>el.scrollTop=0)
   const active=page.locator('.study-card').first()
   assert.equal(await active.locator('details,summary,.expand-all').count(),0)
   const keys=await active.locator('[data-study-section]').evaluateAll(es=>es.map(e=>e.dataset.studySection))
   assert.deepEqual(keys,[...keys].sort((a,b)=>order.indexOf(a)-order.indexOf(b)))
   const body=(await active.innerText()).replace(/\s+/g,' ')
   const texts=[entry.common_meaning,entry.contextual_meaning,entry.latest_sentence,entry.generated_example?.sentence,entry.generated_example?.translation,entry.memory_hint,entry.note,entry.morphology?.note,...(entry.morphology?.forms||[]).map(f=>f.word),...['synonyms','antonyms','similar_forms','local_similar'].flatMap(k=>(entry[k]||[]).flatMap(x=>[x.word,x.note]))].filter(Boolean)
   for(const text of texts)assert.ok(body.includes(text.replace(/\s+/g,' ')),'lost text '+samples[i].label)
   const geometry=await active.evaluate((card,measureSource)=>{
    const measure=eval('('+measureSource+')'),scroll=card.querySelector('.study-scroll'),flow=card.querySelector('.reading-flow'),hint=card.querySelector('.hint-text'),buttons=[...card.querySelectorAll('.study-footer button')]
    return {flow:measure(flow),hint:measure(hint),horizontal:scroll.scrollWidth>scroll.clientWidth+2,rootOverflow:document.documentElement.scrollWidth>innerWidth+2,readingHeight:scroll.clientHeight,scroll:scroll.scrollHeight-scroll.clientHeight,controls:buttons.every(e=>{const b=e.getBoundingClientRect();return b.x>=0&&b.right<=innerWidth+1&&b.bottom<=innerHeight+1})}
   },measureColumns.toString())
   const row={sample:i,label:samples[i].label,width,height,scale,dark,fields:keys,...geometry};rows.push(row)
   assert.equal(geometry.horizontal,false,JSON.stringify(row));assert.equal(geometry.rootOverflow,false);assert.ok(geometry.controls&&geometry.readingHeight>=45,JSON.stringify(row))
   for(const region of ['flow','hint']){
    const m=geometry[region];if(!m)continue
    assert.deepEqual(m.outside,[],JSON.stringify(row))
    if(m.applicable)assert.ok(m.difference<=2*m.maxLine+.5,'unequal '+JSON.stringify(row))
   }
   await page.locator('.study-scroll[data-identity]').evaluate(el=>el.scrollTop=el.scrollHeight)
   if(output&&((width===1205&&[0,3,4,7].includes(i))||(dark&&[3,4,7].includes(i)))){
    await page.screenshot({path:join(output,'sample-'+i+'-'+width+'-'+scale+(dark?'-dark':'')+'-bottom.png')})
    await page.locator('.study-scroll[data-identity]').evaluate(el=>el.scrollTop=0)
    await page.screenshot({path:join(output,'sample-'+i+'-'+width+'-'+scale+(dark?'-dark':'')+'-top.png')})
   }
  }
 }
 assert.deepEqual(errors,[])
 if(output)await writeFile(join(output,'daily-study-visual.json'),JSON.stringify({samples:samples.length,rows,errors},null,2))
 console.log('PASS daily study visual: '+rows.length+' scenarios, real text balance, content completeness, scroll, controls, dark/large fonts, breakpoint and narrow fallback')
}catch(error){if(output)await writeFile(join(output,'daily-study-visual-failure.json'),JSON.stringify({rows,errors,error:String(error)},null,2));throw error}
finally{await browser?.close();await server.close()}
