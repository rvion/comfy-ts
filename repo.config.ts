import { defineRepo } from 'rvlib-shipkit/src/repo-config.ts'

// reviewed SK035 hits, one row each: fingerprint, file, the most matches it may hold (SK035
// prints the word beside each). Every one is a third party ComfyUI node, author or cloud
// workflow name from the vendored manager lists, and the dist types generated from them.
// One more match blocks again
const VENDORED_NAMES: [fp: string, file: string, count: number][] = [
   ['fp:1c076794b629', 'dist/index.d.cts', 4],
   ['fp:1c076794b629', 'dist/index.d.ts', 4],
   ['fp:1c076794b629', 'dist/web.d.ts', 4],
   ['fp:1c076794b629', 'src/manager/generated/KnownComfyPluginTitle.ts', 2],
   ['fp:1c076794b629', 'src/manager/generated/KnownComfyPluginURL.ts', 2],
   ['fp:1c076794b629', 'src/manager/json/custom-node-list.json', 6],
   ['fp:1c076794b629', 'src/manager/json/extension-node-map.json', 2],
   ['fp:1c076794b629', 'src/manager/json/github-stats.json', 2],
   ['fp:62484e22a6a5', 'examples/comfy-cloud/sdk.d.ts', 8],
   ['fp:62484e22a6a5', 'src/manager/json/custom-node-list.json', 2],
   ['fp:d92f4cf1e2d7', 'dist/index.d.cts', 44],
   ['fp:d92f4cf1e2d7', 'dist/index.d.ts', 44],
   ['fp:d92f4cf1e2d7', 'dist/web.d.ts', 44],
   ['fp:d92f4cf1e2d7', 'src/manager/generated/KnownComfyCustomNodeName.ts', 20],
   ['fp:d92f4cf1e2d7', 'src/manager/generated/KnownComfyPluginTitle.ts', 14],
   ['fp:d92f4cf1e2d7', 'src/manager/generated/KnownComfyPluginURL.ts', 6],
   ['fp:d92f4cf1e2d7', 'src/manager/json/custom-node-list.json', 20],
   ['fp:d92f4cf1e2d7', 'src/manager/json/extension-node-map.json', 20],
   ['fp:d92f4cf1e2d7', 'src/manager/json/github-stats.json', 6],
   ['fp:2755f421e08b', 'dist/index.d.cts', 2],
   ['fp:2755f421e08b', 'dist/index.d.ts', 2],
   ['fp:2755f421e08b', 'dist/web.d.ts', 2],
   ['fp:2755f421e08b', 'src/manager/generated/KnownComfyCustomNodeName.ts', 2],
   ['fp:2755f421e08b', 'src/manager/json/extension-node-map.json', 2],
]

export default defineRepo({
   speaksAs: 'rvion',
   hooks: {
      leakAllow: [
         ...VENDORED_NAMES.map(([fp, file, count]) => ({
            reason: 'a third party ComfyUI node or author name in the vendored manager lists, reviewed',
            paths: [file],
            patterns: [fp],
            count,
         })),
         { reason: 'the npm author field: the published maintainer address, public on purpose', paths: ['package.json'], patterns: ['fp:e58aafa3370b'], count: 1 },
      ],
   },
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
