<script setup lang="ts">
import { Github } from 'lucide-vue-next'
import FeedbackButton from './FeedbackButton.vue'
import { COMMUNITY_LINKS } from '../services/communityLinks'
</script>

<template>
  <div class="update-community">
    <FeedbackButton />
    <a class="button secondary github-link" :href="COMMUNITY_LINKS.github" target="_blank" rel="noopener noreferrer" aria-label="GitHub 项目"><Github :size="22" aria-hidden="true" /><span>GitHub 项目</span></a>
  </div>
</template>

<style scoped>
.update-community { display:flex; flex-wrap:wrap; justify-content:flex-end; align-items:flex-start; gap:10px; }
.github-link { white-space:nowrap; }
</style>
