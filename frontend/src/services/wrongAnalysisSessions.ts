import { reactive } from 'vue'
// Transient progress survives navigation; reports remain authoritative in SQLite.
const sessions = new Map<number, { busy:boolean; error:string; completed:number }>()
export function wrongAnalysisSession(unitId:number) {
  if (!sessions.has(unitId)) sessions.set(unitId, reactive({ busy:false, error:'', completed:0 }))
  return sessions.get(unitId)!
}
