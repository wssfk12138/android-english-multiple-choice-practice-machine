import assert from 'node:assert/strict'
import {reconcileDueQueue,orderedDueKeys,completeDueWord} from '../src/vocabulary-due-queue.ts'
const day=86400000;let now=Date.UTC(2026,8,1)
let words=Array.from({length:100},(_,i)=>({term:'word'+i,normalized_term:'word'+i,translation_status:'ready',created_at:new Date(now-day*(100-i)).toISOString()}))
let queue=reconcileDueQueue(null,words,now);const first=[...queue.main];const reviewed=[]
for(let date=0;date<10;date++){
 for(let i=0;i<10;i++){
  queue=reconcileDueQueue(JSON.parse(JSON.stringify(queue)),words,now)
  const key=orderedDueKeys(queue)[0];reviewed.push(key)
  queue=completeDueWord(queue,key)
  const word=words.find(w=>w.normalized_term===key);word.last_reviewed_at=new Date(now).toISOString();word.next_review_at=new Date(now+120*day).toISOString()
 }
 now+=day
 words.push({term:'new'+date,normalized_term:'new'+date,translation_status:'ready',created_at:new Date(now).toISOString()})
}
assert.deepEqual(reviewed,first)
const main=Array.from({length:10},(_,i)=>'m'+i),again=['a','b','c']
assert.deepEqual(orderedDueKeys({version:1,main,relearning:again,ordinarySinceRelearning:0}).slice(0,10),['m0','m1','m2','m3','a','m4','m5','m6','m7','b'])
const stale={version:1,main:['gone','later','valid','valid'],relearning:[],ordinarySinceRelearning:0}
assert.deepEqual(reconcileDueQueue(stale,[{term:'later',translation_status:'ready',next_review_at:new Date(now+day).toISOString()},{term:'valid',translation_status:'ready'}],now).main,['valid'])
console.log('PASS persistent fair queue: 100 words over 10 days, newcomers, 4:1 relearning, deletion and synced review pruning')
