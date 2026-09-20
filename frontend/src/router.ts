import { createRouter, createWebHistory } from 'vue-router'
import AiAssistant from './components/AiAssistant.vue'
import DashboardView from './views/DashboardView.vue'
import ImportView from './views/ImportView.vue'
import LibraryView from './views/LibraryView.vue'
import PracticeView from './views/PracticeView.vue'
import SettingsView from './views/SettingsView.vue'
import WrongView from './views/WrongView.vue'
import WrongAnalysisView from './views/WrongAnalysisView.vue'
import VocabularyView from './views/VocabularyView.vue'
import AndroidVocabularyDisplayView from './views/AndroidVocabularyDisplayView.vue'
import TrashView from './views/TrashView.vue'
import AndroidUpdatesView from './views/AndroidUpdatesView.vue'
import AndroidSyncView from './views/AndroidSyncView.vue'
import AndroidDiagnosticsView from './views/AndroidDiagnosticsView.vue'
import NotesHubView from './views/NotesHubView.vue'
import MobileSettingsView from './views/MobileSettingsView.vue'
import AndroidAppearanceView from './views/AndroidAppearanceView.vue'
import HelpView from './views/HelpView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: DashboardView },
    { path: '/library', component: LibraryView },
    { path: '/practice/:id', component: PracticeView },
    { path: '/wrong', component: WrongView },
    { path: '/wrong/analysis/:unitId', component: WrongAnalysisView },
    { path: '/vocabulary', component: VocabularyView },
    { path: '/android-vocabulary-display', component: AndroidVocabularyDisplayView },
    { path: '/imports', component: ImportView },
    { path: '/assistant', component: AiAssistant },
    { path: '/settings', component: SettingsView },
    { path: '/trash', component: TrashView },
    { path: '/android-updates', component: AndroidUpdatesView },
    { path: '/android-sync', component: AndroidSyncView },
    { path: '/android-diagnostics', component: AndroidDiagnosticsView },
    { path: '/notes', component: NotesHubView },
    { path: '/mobile-settings', component: MobileSettingsView },
    { path: '/android-appearance', component: AndroidAppearanceView },
    { path: '/help', component: HelpView },
  ],
})

// Global guard also handles legacy links when only the query changes.
router.beforeEach(to => {
  if (to.path !== '/android-updates') return
  if (to.hash === '#device-sync') return '/android-sync'
  if (to.hash === '#diagnostics') return '/android-diagnostics'
  if (!to.query.section) return
  if (to.query.section === 'sync') return '/android-sync'
  if (to.query.section === 'diagnostics') return '/android-diagnostics'
  return '/android-updates'
})
export default router
