<template>
  <div class="page mobile-hub notes-hub">
    <div class="page-head compact-page-head">
      <div><span class="eyebrow">STUDY NOTES</span><h1>笔记</h1><p class="lead">把错题复盘和真题词汇放在同一个入口，按需要进入。</p></div>
    </div>
    <div class="mobile-hub-list">
      <RouterLink class="card mobile-hub-item" to="/wrong">
        <img src="/assets/icons/wrong-book.png" alt="">
        <span><strong>错题本</strong><small>按年份与篇目回顾错题，并查看能力分析。</small></span>
        <b aria-hidden="true">›</b>
      </RouterLink>
      <RouterLink class="card mobile-hub-item" to="/vocabulary">
        <img src="/assets/icons/vocabulary.png" alt="">
        <span><strong>单词本</strong><small>复习真题里标记过的词，优先查看近期词汇。</small></span>
        <b aria-hidden="true">›</b>
      </RouterLink>
    </div>
  </div>
</template>
