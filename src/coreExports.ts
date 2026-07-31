// the SHARED export surface of both entries (architecture item 13):
// everything here must stay web-safe — node-only exports live in index.ts.

// global Comfy.* base namespace + per-host sdk registry (side-effectful types)
export * from 'src/types/comfy-sdk.ts'

// entrypoint singleton
export { ComfyTS } from 'src/state.ts'

// host
export {
   ComfyHost,
   ComfyHostAuthError,
   ComfyHostUnreachableError,
   type ComfyHostData,
   type ComfyHostID,
   type ConnectOptions,
} from 'src/host/ComfyHost.ts'
export { type ParsedHostBase, parseHostBase, renderHttpBase, renderWsUrl } from 'src/host/hostUrl.ts'
export { ComfyManager } from 'src/host/ComfyManager.ts'
export { ComfyUploader, type ComfyUploadImageResult } from 'src/host/ComfyUploader.ts'
export { ComfyWorkflowBuilder } from 'src/host/ComfyWorkflowBuilder.ts'
export type { Requirements, PluginInstallStatus, PluginSuggestion } from 'src/host/Requirements.ts'
export { ResilientWebSocketClient } from 'src/host/ResilientWebsocket.ts'

// runner
export {
   ComfyWorkflow,
   type ComfyNodeIdMode,
   type ComfyWorkflowData,
   type ComfyWorkflowID,
   type ExecutionSnapshot,
   type ProgressReport,
   type RunSettings,
} from 'src/runner/ComfyWorkflow.ts'
export { ComfyExecution, type ComfyExecutionData, type ExecutionProgress } from 'src/runner/ComfyExecution.ts'
export type { PromptID, WsMsg, PromptRelated_WsMsg } from 'src/runner/ComfyWsApi.ts'
export { MediaImage, type MediaImageData } from 'src/runner/MediaImage.ts'
export type { ComfyExecutionStatus } from 'src/runner/ComfyExecutionStatus.ts'
export { InvalidPromptError } from 'src/errors/InvalidPromptError.ts'

// graph (programmatic node graph)
export { ComfyNode } from 'src/graph/ComfyNode.ts'
export { ComfyNodeOutput } from 'src/graph/ComfyNodeOutput.ts'
export type { ComfyNodeMetadata, ComfyNodeId } from 'src/graph/ComfyNodeID.ts'
export { auto, auto_ } from 'src/graph/autoValue.ts'

// sdk generator (schema parsing + per-host codegen)
export { ComfySchema } from 'src/sdk-generator/ComfySchema.ts'
export { codegenSDK, hostIdToNamespace, type CodegenOptions } from 'src/sdk-generator/comfyui-sdk-codegen.ts'
export type { ComfyNodeSchemaJSON, ComfySchemaJSON } from 'src/sdk-generator/ComfyUIObjectInfoTypes.ts'
export type { ComfyImageName, ComfyUnionValue, QualifiedNodeKey } from 'src/sdk-generator/comfyui-types.ts'
export type { ComfyApiJson, ComfyApiNodeJson } from 'src/sdk-generator/comfy-api-json.ts'

// litegraph (ComfyUI saved-workflow JSON format)
export type { LiteGraphJSON } from 'src/litegraph/LiteGraphJSON.ts'
export { convertFlowToLiteGraphJSON } from 'src/litegraph/convertFlowToLiteGraphJSON.ts'
export type {
   CanonicalGroup,
   CanonicalInput,
   CanonicalLink,
   CanonicalNode,
   CanonicalOutput,
   CanonicalWidgetValues,
   CanonicalWorkflow,
   NodeMode,
} from 'src/litegraph/CanonicalWorkflow.ts'
export { normalizeWorkflow, parseWorkflowJson, WorkflowNormalizeError } from 'src/litegraph/normalizeWorkflow.ts'
export { convertLiteGraphToPrompt, WorkflowConvertError } from 'src/sdk-generator/litegraphToApiRequestPayload.ts'

// vars + re-runnable workflows
export {
   v,
   ComfyVarBase,
   ComfyVar,
   TextVar,
   PromptVar,
   IntVar,
   FloatVar,
   SeedVar,
   ToggleVar,
   ChoiceVar,
   LorasVar,
   SizeVar,
   ImageVar,
   ImageVarEmptyError,
   DEFAULT_SIZE_PRESETS,
   DEFAULT_IMAGE_EXTENSIONS,
   activeLoras,
} from 'src/vars/ComfyVars.ts'
export type {
   AnyVar,
   VarKind,
   VarsSpec,
   VarValues,
   PromptValue,
   ActiveLoraSource,
   LorasHost,
   LoraStrength,
   ActiveLora,
   SizeValue,
   SizePreset,
   ImageVarOpts,
} from 'src/vars/ComfyVars.ts'
export { DefinedWorkflow, type DefineWorkflowSpec, type BoundVars, type LoraNameOf } from 'src/vars/DefinedWorkflow.ts'
export { getLoraKeyword, setLoraKeyword } from 'src/vars/loraKeywords.ts'
export { loraTag } from 'src/utils/loraTag.ts'

// shared types
export * from 'src/types/index.ts'

// the storage seam (custom backends: ComfyTS.create({ storage }))
export {
   type ComfyStorage,
   createMemoryStorage,
   getComfyStorage,
   setDefaultComfyStorage,
} from 'src/storage/ComfyStorage.ts'
export type { WsLike, WsMessageEvent } from 'src/host/ResilientWebsocket.ts'
