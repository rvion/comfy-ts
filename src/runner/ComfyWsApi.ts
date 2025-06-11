import { scope, type } from 'arktype'
import { ComfyNodeId_ark } from '../livegraph/ComfyNodeID' // Aliased import

// Define ComfyPromptID as it's used by PromptID_ark
export type ComfyPromptID = string

export type PromptID = ComfyPromptID // Branded<UUID, { ComfyPromptID: true }>
export const PromptID_ark = type.string.as<PromptID>()

// Define the scope and export its types for inference
const tempScope = scope({
   PromptID: PromptID_ark,
   ComfyNodeID: ComfyNodeId_ark, // Use the aliased schema
   Timestamp: 'number', // Define Timestamp directly in the scope

   ApiPromptInput: {
      client_id: 'string',
      extra_data: { extra_pnginfo: 'unknown' },
      prompt: 'unknown',
   },

   NodeProgress: { value: 'number', max: 'number' },

   ComfyStatusData: {
      'sid?': 'string',
      status: {
         exec_info: { queue_remaining: 'number' },
         'sid?': 'string',
      },
   },
   WsMsgStatus: {
      type: "'status'",
      data: 'ComfyStatusData',
   },

   _WsMsgExecutionStartData: { prompt_id: 'PromptID' },
   WsMsgExecutionStart: {
      type: "'execution_start'",
      data: '_WsMsgExecutionStartData',
   },

   _WsMsgExecutionCachedData: { nodes: 'ComfyNodeID[]', prompt_id: 'PromptID' },
   WsMsgExecutionCached: {
      type: "'execution_cached'",
      data: '_WsMsgExecutionCachedData',
   },

   _WSMsgExecutingData: {
      prompt_id: 'PromptID',
      'node?': 'ComfyNodeID',
   },
   WsMsgExecuting: {
      type: "'executing'",
      data: '_WSMsgExecutingData',
   },

   ComfyImageInfo: {
      filename: 'string',
      subfolder: 'string',
      type: 'string',
   },
   _WsMsgExecutedData: {
      node: 'ComfyNodeID',
      output: {
         'previews?': [{ filepath: 'string' }],
         'images?': 'ComfyImageInfo[]',
      },
      prompt_id: 'PromptID',
   },
   WsMsgExecuted: {
      type: "'executed'",
      data: '_WsMsgExecutedData',
   },

   WsMsgExecutionSuccessData: {
      prompt_id: 'PromptID',
      timestamp: 'Timestamp',
   },
   WsMsgExecutionSuccess: {
      type: "'execution_success'",
      data: 'WsMsgExecutionSuccessData',
   },

   _WsMsgExecutionErrorData: {
      prompt_id: 'PromptID',
      node_id: 'ComfyNodeID',
      node_type: 'string',
      executed: 'ComfyNodeID[]',
      exception_message: 'string',
      exception_type: 'string',
      traceback: 'string[]',
      current_inputs: 'Record<string, unknown>',
      current_outputs: 'Record<string, unknown>',
   },
   WsMsgExecutionError: {
      type: "'execution_error'",
      data: '_WsMsgExecutionErrorData',
   },

   WSMsgManagerFeedbackData: { data: 'string' },
   WSMsgManagerFeedback: {
      type: "'manager-terminal-feedback'",
      data: 'WSMsgManagerFeedbackData',
   },

   // WsMsgProgress must be after NodeProgress
   WsMsgProgress: { type: "'progress'", data: 'NodeProgress' },

   // UNION TYPES
   PromptRelated_WsMsg:
      'WsMsgExecutionStart | WsMsgExecutionCached | WsMsgExecuting | WsMsgProgress | WsMsgExecuted | WsMsgExecutionError | WsMsgExecutionSuccess',
   WsMsg: 'WsMsgStatus | WSMsgManagerFeedback | PromptRelated_WsMsg',
})

export const types = tempScope.export()

// REQUEST PAYLOADS ------------------------------------------------
export type ApiPromptInput = typeof types.ApiPromptInput.infer

// MISC -------------------------------------------------------------
export type NodeProgress = typeof types.NodeProgress.infer

// LIVE UPDATES ----------------------------------------------------
export type PromptRelated_WsMsg = typeof types.PromptRelated_WsMsg.infer
export type WsMsg = typeof types.WsMsg.infer
export type ComfyStatusData = typeof types.ComfyStatusData.infer
export type WsMsgStatus = typeof types.WsMsgStatus.infer
export type WsMsgExecutionStart = typeof types.WsMsgExecutionStart.infer
export type WsMsgExecutionCached = typeof types.WsMsgExecutionCached.infer
export type _WSMsgExecutingData = typeof types._WSMsgExecutingData.infer
export type WsMsgExecuting = typeof types.WsMsgExecuting.infer
export type WsMsgProgress = typeof types.WsMsgProgress.infer
export type WsMsgExecuted = typeof types.WsMsgExecuted.infer
export type WsMsgExecutionSuccess = typeof types.WsMsgExecutionSuccess.infer
export type WsMsgExecutionError = typeof types.WsMsgExecutionError.infer
export type WSMsgManagerFeedback = typeof types.WSMsgManagerFeedback.infer
export type _WsMsgExecutionStartData = typeof types._WsMsgExecutionStartData.infer
export type _WsMsgExecutionCachedData = typeof types._WsMsgExecutionCachedData.infer
export type ComfyImageInfo = typeof types.ComfyImageInfo.infer
export type _WsMsgExecutedData = typeof types._WsMsgExecutedData.infer
export type _WsMsgExecutionErrorData = typeof types._WsMsgExecutionErrorData.infer

export type PromptInfo = { prompt_id: PromptID }

export const WsMsg_ark = types.WsMsg
