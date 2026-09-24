import { defineRepo } from 'rvlib-shipkit/src/repo-config.ts'

export default defineRepo({
    identity: { colorLight: '#1453ad', colorDark: '#6da2ee' },
    name: 'comfy-ts',
    visibility: 'public',
    release: { npm: true },
    tests: {
        slow: [
            {
                file: 'tests/npm-tarball-parity.test.ts',
                catches: 'bun pm pack drifting from npm pack: npm-tarball.test.ts guards the tarball through bun\'s packer, and npm is what publishes',
                whyNotFast: 'npm pack tars the whole payload even with --dry-run: 2.1s of CPU in npm itself, --ignore-scripts saves nothing. prepublishOnly runs it before every publish',
            },
        ],
    },
})
