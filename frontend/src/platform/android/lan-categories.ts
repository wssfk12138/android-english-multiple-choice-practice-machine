export const CATEGORY_TABLES = {
  practice: ["practice_sessions", "practice_answers", "practice_answer_events", "practice_unit_submissions"],
  models: ["ai_profiles"],
  question_bank: [],
  vocabulary: ["vocabulary_entries", "vocabulary_occurrences", "vocabulary_reviews"],
  wrong: ["wrong_stats", "wrong_retry_rounds", "wrong_retry_round_questions", "wrong_current_questions"],
} satisfies Record<string, string[]>
export type LanCategory = keyof typeof CATEGORY_TABLES
export const DEPENDENCY_TIMESTAMP = '0001-01-01T00:00:00Z'
export const DEFAULT_CATEGORIES: LanCategory[] = ["practice", "models", "vocabulary", "wrong"]
export const CATEGORY_LABELS: Record<LanCategory, string> = {
  practice: "做题记录", models: "模型配置（含密钥）", question_bank: "题库（电脑到安卓）",
  vocabulary: "单词本", wrong: "错题本",
}

export function validateCategories(value: unknown): LanCategory[] {
  if (!Array.isArray(value) || value.length > 5 || new Set(value).size !== value.length
    || value.some(item => typeof item !== "string" || !Object.hasOwn(CATEGORY_TABLES, item))) {
    throw new Error("同步类别无效")
  }
  return value as LanCategory[]
}

export function categoryAgreement(data: any, selected: LanCategory[]): LanCategory[] {
  if (data?.category_protocol !== 1) throw new Error("电脑端不支持分类权限，请升级电脑端后同步")
  const host = validateCategories(data.host_categories)
  const effective = validateCategories(data.effective_categories)
  const expected = selected.filter(item => host.includes(item))
  if (effective.length !== expected.length || effective.some(item => !expected.includes(item))) {
    throw new Error("电脑端同步权限交集无效")
  }
  return effective
}

const dependencyFields = new Set(["sync_id", "profile_name", "mode", "paper_id_key", "unit_ids_keys",
  "status", "started_at", "updated_at", "_dependency", "content_snapshot", "content_revisions"])

export function sessionDependency(payload: Record<string, any>): Record<string, any> {
  return { ...Object.fromEntries(Object.entries(payload).filter(([key]) => dependencyFields.has(key))),
    mode: "wrong", status: "completed", updated_at: DEPENDENCY_TIMESTAMP, _dependency: true }
}

export function validateCategoryBatch(category: LanCategory, changes: Record<string, Record<string, any>[]>,
  tombstones: Record<string, any>[]): void {
  const allowed: readonly string[] = CATEGORY_TABLES[category]
  for (const [table, items] of Object.entries(changes)) {
    if (!allowed.includes(table) && !(category === "wrong" && table === "practice_sessions")) {
      throw new Error("同步数据超出所选类别")
    }
    for (const item of items) {
      if (["api_key", "api_key_encrypted", "api_keys", "keys"].some(key => key in item)) {
        throw new Error("当前协议禁止传输模型密钥")
      }
      if (category === "wrong" && table === "practice_sessions") {
        if (Object.keys(item).some(key => !dependencyFields.has(key)) || item._dependency !== true
          || item.mode !== "wrong" || item.status !== "completed"
          || item.updated_at !== DEPENDENCY_TIMESTAMP
          || !(changes.wrong_retry_rounds || []).some(round => round.session_id_key === item.sync_id
            && (round.profile_name || "") === (item.profile_name || ""))) {
          throw new Error("错题本包含无关会话或额外做题数据")
        }
      } else if ("_dependency" in item || item.updated_at === DEPENDENCY_TIMESTAMP) throw new Error("同步依赖标记无效")
    }
  }
  if (tombstones.some(item => !allowed.includes(item.table_name))) throw new Error("删除记录超出所选类别")
}
