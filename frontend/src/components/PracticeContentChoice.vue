<script setup lang="ts">
defineProps<{busy: boolean; error: string}>()
defineEmits<{choose: [choice: 'continue' | 'restart']}>()
</script>
<template>
  <section class="content-choice" role="region" aria-labelledby="content-choice-title">
    <h2 id="content-choice-title">这份练习的题库内容已修正</h2>
    <p>原练习的历史记录和成绩不会删除。请选择本次如何继续：</p>
    <button class="button" :disabled="busy" @click="$emit('choose', 'restart')">用修正版继续练习</button>
    <p>使用修正后的内容继续作答：未受修正影响的题目会保留你的选择，有改动的题目需要重新作答；已提交篇目的成绩原样带入。</p>
    <button class="button secondary" :disabled="busy" @click="$emit('choose', 'continue')">继续原来的练习</button>
    <p>继续使用旧内容、原选项顺序及原评分依据，其中可能仍含已发现的错误。进度和成绩原样保留，但不更新修正版的错题统计与复习队列。</p>
    <p v-if="error" role="alert">{{ error }}</p>
  </section>
</template>
<style scoped>
.content-choice{box-sizing:border-box;max-width:42rem;margin:24px auto;padding:24px;border:1px solid var(--border);border-radius:16px;background:var(--surface)}
.content-choice p{line-height:1.7;overflow-wrap:anywhere}
.content-choice .button{max-width:100%;white-space:normal}
@media(max-width:600px){.content-choice{margin:12px;padding:16px}.content-choice .button{width:100%}}
</style>
