<script setup lang="ts">
defineProps<{ number?: number }>()
</script>

<template>
  <span class="passage-blank" :aria-label="`第 ${number} 空`"><span class="blank-number">{{ number }}</span></span>
</template>
