import { defineRepo } from 'rvlib-shipkit/src/repo-config.ts'

export default defineRepo({
   // >>> shipkit ignored inputs — managed block, the traced audit writes it, edit outside the markers
   ignoredInputs: {
      test: [
         '.claude/settings.local.json',
         '.comfy-ts/cache/**',
         '.comfy-ts/drafts/**',
         '.comfy-ts/hosts',
         '.comfy-ts/llm-configs/**',
         '.comfy-ts/outputs/**',
         '.comfy-ts/serve-tabs.json',
         '.comfy-ts/templates/**',
         '.shipkit/journal/**',
         '.shipkit/private/**',
         '.shipkit/reflections/**',
         '.shipkit/rvion-fr/**',
         '.shipkit/rvion-fr/assets/cover.jpg',
         '.shipkit/rvion-fr/page.md',
         '.shipkit/social/**',
         '.shipkit/wrapper',
         '.tmp/**',
         'CLAUDE.local.md',
         'agent/global-contribution.md',
         'dist',
      ],
      typecheck: [
         '.comfy-ts/hosts/**',
         '.comfy-ts/hosts/windows-1/sdk.d.ts',
      ],
   },
   // <<< shipkit ignored inputs
   identity: { colorLight: '#1453ad', colorDark: '#6da2ee' },
   name: 'comfy-ts',
   visibility: 'public',
   release: { npm: true, npmTokenCommand: ['rv-secret', 'get', 'rv/npm/token'] },
})
