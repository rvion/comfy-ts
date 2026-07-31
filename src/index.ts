/**
 * comfy-ts — type-safe ComfyUI workflow creation and execution (NODE entry)
 * @packageDocumentation
 */
import { setDefaultComfyStorage } from 'src/storage/ComfyStorage.ts'
import { createNodeStorage } from 'src/storage/nodeStorage.ts'

// entry side effect: node 20/21 dist consumers have no getBuiltinModule
// autodetect, so the node backend installs here (architecture item 13)
setDefaultComfyStorage(createNodeStorage())

export * from 'src/coreExports.ts'

// node-only surface: fs-backed example assets + the TUI env contract
export { exampleImagePath } from 'src/exampleAssets.ts'
export { isTuiActive } from 'src/cli/tui-env.ts'
