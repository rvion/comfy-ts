import type { ComfyHost } from 'src/host/ComfyHost.ts'
import type { ComfyExecution } from 'src/runner/ComfyExecution.ts'
import type { ComfyWorkflow, RunSettings } from 'src/runner/ComfyWorkflow.ts'
import type { SdkForHost } from 'src/types/comfy-sdk.ts'
import {
   type AnyVar,
   type LorasVar,
   type LoraStrength,
   v,
   type VarsSpec,
   type VarValues,
   varValues,
} from 'src/vars/ComfyVars.ts'

/** the host's generated lora-name union (plain string when no sdk is generated) */
export type LoraNameOf<ID extends string> = 'E_LoraName' extends keyof SdkForHost<ID>['Union']
   ? SdkForHost<ID>['Union']['E_LoraName'] & string
   : string

/**
 * the `v` handed to a vars LAMBDA: the global factory, host-typed —
 * `v.loras(regex)` yields the host's lora-name union (resolved via bindHost)
 */
export type BoundVars<ID extends string> = Omit<typeof v, 'loras'> & {
   loras(
      options: RegExp,
      initial?: Partial<Record<LoraNameOf<ID>, LoraStrength>>,
      label?: string,
   ): LorasVar<LoraNameOf<ID>>
   loras<T extends string>(
      options: readonly T[],
      initial?: Partial<Record<T, LoraStrength>>,
      label?: string,
   ): LorasVar<T>
}

export type DefineWorkflowSpec<ID extends string, V extends VarsSpec> = {
   /** short id; also names the workflow instances */
   id?: string
   /** optional TUI tree color (ink color name or hex); unset = the tree's
    * per-family palette (first `-` word of the module basename) */
   color?: string
   /** the tweakable knobs; drivers (scripts, TUI) edit these between runs.
    * A LAMBDA gives cross-referencing vars a scope (loras + prompt with
    * loraKeywordsFrom created inline) — resolved ONCE at define time, and it
    * RECEIVES the host-typed `v` (no import needed) */
   vars: V | ((v: BoundVars<ID>) => V)
   /** builds the graph from the CURRENT var values; re-executed on every run().
    * may be async (e.g. image uploads through the wf param) */
   build: (b: SdkForHost<ID>['Builder'], vars: VarValues<V>, wf: ComfyWorkflow<ID>) => void | Promise<void>
}

/** type predicate (not a cast): a VarsSpec is a plain record, never callable */
function isVarsThunk<ID extends string, V extends VarsSpec>(
   vars: V | ((v: BoundVars<ID>) => V),
): vars is (v: BoundVars<ID>) => V {
   return typeof vars === 'function'
}

/**
 * a re-runnable workflow definition: `build` re-executes per run with the
 * current var values, so every run gets a fresh, deterministic graph.
 */
export class DefinedWorkflow<ID extends string = string, V extends VarsSpec = VarsSpec> {
   /** spec.vars resolved once (may be given as a thunk) — the SAME instances for the workflow's lifetime */
   readonly vars: V

   constructor(
      public host: ComfyHost<ID>,
      public spec: DefineWorkflowSpec<ID, V>,
   ) {
      // cast: whitelist family 1 (agent/coding.md) — the runtime `v` IS the
      // factory BoundVars describes; the regex-loras typing claim it adds is
      // resolved from the same object_info enum via bindHost below
      this.vars = isVarsThunk(spec.vars) ? spec.vars(v as BoundVars<ID>) : spec.vars
      // define-time var wiring: the spec key becomes the var's name (error
      // messages name the var with it), host-dependent vars (v.loras(regex))
      // resolve their options
      for (const [key, varDef] of this.entries()) {
         varDef.name = key
         varDef.bindHost?.(this.host)
      }
   }

   /** [name, var] pairs, for drivers that enumerate the knobs */
   entries(): [string, AnyVar][] {
      return Object.entries(this.vars)
   }

   /** the workflow built by the latest run() (null before the first run) */
   lastWorkflow: ComfyWorkflow<ID> | null = null
   /** the latest execution (null before the first run) */
   lastExecution: ComfyExecution | null = null

   /**
    * build a fresh graph from the CURRENT var values (no send). `p.advance`
    * (set by run()) fires each var's afterRun() right after snapshotting the
    * values — atomically, before any await — so the graph uses this run's seed
    * while the var moves to the next (queued runs get distinct seeds; a bare
    * build() for copy/export never advances). `p.host` substitutes the host
    * the graph is built against (TUI host override): node/model availability
    * there surfaces as workflow.problems / server validation, by design.
    */
   async build(p: { advance?: boolean; host?: ComfyHost<ID> } = {}): Promise<ComfyWorkflow<ID>> {
      const host = p.host ?? this.host
      const wf = host.workflow({ id: this.spec.id })
      const values = varValues(this.vars)
      if (p.advance) for (const varDef of Object.values(this.vars)) varDef.afterRun()
      await this.spec.build(wf.builder, values, wf)
      this.lastWorkflow = wf
      return wf
   }

   /** build a fresh graph from the current var values, send it, wait for outputs.
    * connects first (idempotent) — modules can import offline from the schema cache.
    * `settings.host` runs against THAT host instead of the defining one. */
   async run(settings: RunSettings & { host?: ComfyHost<ID> } = {}): Promise<ComfyExecution> {
      const host = settings.host ?? this.host
      await host.connect()
      const wf = await this.build({ advance: true, host })
      const execution = await wf.run({
         save: settings.save,
         ephemeral: settings.ephemeral,
         scrubHistory: settings.scrubHistory,
         idMode: settings.idMode,
         log: settings.log,
         onProgress: settings.onProgress,
      })
      this.lastExecution = execution
      return execution
   }
}
