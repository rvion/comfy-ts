import type { ExecutionSnapshot } from 'src/runner/ComfyWorkflow.ts'

export class InvalidPromptError extends Error {
   constructor(
      public override message: string,
      /** exactly what was sent to the host when the error happened */
      public snapshot: ExecutionSnapshot,
      public details: unknown,
   ) {
      super(message)
   }
}
