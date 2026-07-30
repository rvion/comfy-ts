import { type } from 'arktype'

/** ONE github-stats.json entry, keyed by repo url in the file root (a Record, validated row by row) */
export type ComfyManagerGithubStatEntry = typeof ComfyManagerGithubStatEntry_ark.infer
export const ComfyManagerGithubStatEntry_ark = type({
   stars: 'number',
   last_update: 'string', // "2026-07-28 03:14:59"
   author_account_age_days: 'number',
})
