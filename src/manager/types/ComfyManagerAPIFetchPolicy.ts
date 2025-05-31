import { type } from 'arktype'

/**
 * 'cache' : DB: Channel (1day cache)'
 * 'local' : local 'DB: Local'
 * 'url'   : DB: Channel (remote)
 */
export type ComfyManagerAPIFetchPolicy = typeof ComfyManagerAPIFetchPolicy_ark.infer
export const ComfyManagerAPIFetchPolicy_ark = type("'cache' | 'local' | 'url'")
