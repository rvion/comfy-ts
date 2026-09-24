import { defineRepo } from 'rvlib-shipkit/src/repo-config.ts'

export default defineRepo({
    identity: { colorLight: '#1453ad', colorDark: '#6da2ee' },
    name: 'comfy-ts',
    visibility: 'public',
    release: { npm: true },
    tests: {
        slow: [
            {
                file: 'tests/npm-tarball.test.ts',
                catches: 'a private file riding into the published tarball (a whitelisted dir re-includes gitignored paths: the 0.3.0 pack carried an ssh private key), and README variants npm force-includes',
                whyNotFast: 'only npm pack knows its own whitelist and force-include rules, and it tars the whole payload even with --dry-run: 2.1s of CPU in npm itself, --ignore-scripts saves nothing. prepublishOnly runs it before every publish, which is when the tarball exists',
            },
        ],
    },
})
