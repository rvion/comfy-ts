// local LLMs inside ComfyUI, no api key and no second service: core's `TextGenerate`
// (comfy_extras.nodes_textgen, aliased "LLM"/"gemma" in the node search) runs a chat model
// loaded through the ORDINARY text-encoder path — CLIPLoader with any `type`, the loader
// ignores it and hands the causal LM to the generator. A STRING output reaches TypeScript
// only through an output node's ui payload, so PreviewAny terminates the graph and the
// result lands in `execution.text`.
//
// The point of this one is measurement, not pictures: which text encoders on a given box
// are actually generative, how fast, and how well they expand a short prompt.
//
// run directly:  bun examples/rvion/07-local-llm-text-gen.cflow.ts ["a cat on a roof"]
// probe the box: bun examples/rvion/07-local-llm-text-gen.cflow.ts --sweep
import { ComfyTS, v } from 'comfy-ts'

const comfy = ComfyTS.create()
const host = comfy.host({ id: 'windows-1', host: 'desktop-im18794', port: 8085 })
await host.loadSchemaFromCache() // offline import; run() connects lazily

// generative on this box (measured, see --sweep). Every entry is a plain text_encoders/
// file: nothing here was installed for LLM use, they arrived with image models.
const GENERATIVE = [
   'qwen_3_4b.safetensors', // best answers, but REASONS first: needs ~1024 tokens to get past <think>
   'ernie-image-prompt-enhancer.safetensors', // 4s, purpose-built expander; drifts into repetition past ~128 tokens
   'qwen3vl_4b_fp8_scaled.safetensors', // vision-language, also takes an `image` input
   'ministral-3-3b.safetensors', // no chat template: echoes the instruction before answering
] as const

// every text encoder on the box, generative or not — the --sweep corpus. The non-generative
// ones are the control: an encoder-only T5/CLIP has no `.generate` and must fail.
const SWEEP_CANDIDATES = [
   ...GENERATIVE,
   'qwen_3_8b_fp8mixed.safetensors',
   'mistral_3_small_flux2_bf16.safetensors',
   'qwen_2.5_vl_7b_fp8_scaled.safetensors',
   'clip_l.safetensors',
   't5\\t5xxl_fp8_e4m3fn_scaled.safetensors',
   'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
] as const

type TextGenParams = {
   model: (typeof SWEEP_CANDIDATES)[number]
   instruction: string
   subject: string
   maxLength: number
   temperature: number
   repetitionPenalty: number
   seed: number
   thinking: boolean
   streaming: boolean
}

/** core `TextGenerate` hands back the answer once, at the end. `StreamTextGenerate` publishes
 * it every few tokens instead, so you WATCH it write — the protocol always could (a node
 * publishes live text on binary ws frame type 3), core just never calls it. Ships in
 * extra/comfyui-textgen-stream/, copy that folder into ComfyUI/custom_nodes/ to get it.
 * Feature-detected, never assumed: on a host without it the graph falls back to core */
const STREAMING_NODE = 'StreamTextGenerate'
/** the builder key of a custom node is qualified by its python module, so it follows the
 * FOLDER you installed it under (`comfyui-textgen-stream` → `textgen-stream.`) */
const STREAMING_NODE_KEY = 'textgen-stream.StreamTextGenerate'
const hasStreamingNode = host.schema.nodes.some((n) => n.nameInComfy === STREAMING_NODE)

/** the whole graph, shared by the tweakable workflow below and the --sweep probe */
const buildTextGen = (b: Comfy.Windows1.Builder, p: TextGenParams): void => {
   const clip = b.CLIPLoader({
      clip_name: p.model,
      // the loader ignores `type` for a causal LM; the official llm templates spell it
      // 'stable_diffusion' too
      type: 'stable_diffusion',
      device: 'default',
   })
   const shared = {
      clip,
      prompt: `${p.instruction}\n\n${p.subject}`,
      max_length: p.maxLength,
      thinking: p.thinking,
      // the branch's remaining knobs (top_k, top_p, min_p) fill from the schema — the host
      // declares them required and defaults none of them
      sampling_mode: 'on',
      'sampling_mode.temperature': p.temperature,
      'sampling_mode.repetition_penalty': p.repetitionPenalty,
      'sampling_mode.seed': p.seed,
   } as const
   const generated = p.streaming ? b[STREAMING_NODE_KEY]({ ...shared, stream_every: 4 }) : b.TextGenerate({ ...shared })
   b.PreviewAny({ source: generated._STRING })
}

export const localLlmTextGen = host.defineWorkflow({
   id: 'local-llm-text-gen',
   vars: {
      model: v.choice(GENERATIVE, 'qwen_3_4b.safetensors', 'llm'),
      // every one of these wants FRAMING: fed a bare subject, the enhancer models
      // continue the text instead of expanding it (ernie writes a novel's front matter)
      instruction: v.text(
         'You expand short image prompts into vivid detailed ones. Reply with only the expanded prompt, one sentence.',
         // a system prompt is a paragraph you rewrite, not a value you type once
         { label: 'instruction', multiline: true },
      ),
      subject: v.text('a cat on a roof', { label: 'subject', multiline: true }),
      // the budget must cover the whole answer INCLUDING a reasoning preamble, and a
      // truncated run just stops mid-word: ~1024 for qwen3, ~128 for ernie (which pads
      // with repetition once past its natural length)
      maxLength: v.int(1024, { min: 16, max: 4096, label: 'max tokens' }),
      temperature: v.float(0.7, { min: 0.01, max: 2 }),
      // small models pad by repeating themselves; raising this is the lever against it
      repetitionPenalty: v.float(1.05, { min: 1, max: 2, label: 'repetition penalty' }),
      seed: v.seed(1),
      // qwen3 reasons whatever this says (the flag only binds when the model's template
      // exposes the toggle) — answerOf() below drops the <think> block either way
      thinking: v.toggle(false, 'reason before answering'),
      // defaults to ON where the host has the node, so it needs no explanation when it works
      // and tells the truth when the node is absent
      streaming: v.toggle(hasStreamingNode, 'watch it write (needs the streaming node)'),
   },
   build: (b, vars) => buildTextGen(b, { ...vars, streaming: vars.streaming && hasStreamingNode }),
})

export default localLlmTextGen

/** a reasoning model narrates inside <think> before answering; keep the answer */
const answerOf = (text: string): string => {
   const closed = text.split('</think>')
   const answer = (closed.length > 1 ? closed.at(-1) : text) ?? text
   return answer.trim()
}

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   const sweeping = process.argv.includes('--sweep')

   if (!sweeping) {
      if (process.argv[2]) localLlmTextGen.vars.subject.set(process.argv[2])
      const execution = await localLlmTextGen.run({ log: true })
      const text = execution.text
      if (text == null) console.log('🔴 no text output — the model produced nothing')
      else console.log(`\n${answerOf(text)}\n`)
      host.disconnect()
   } else {
      // one row per text encoder on the box: does it generate at all, how fast, what does it say
      console.log(`probing ${SWEEP_CANDIDATES.length} text encoders on ${host.data.id}`)
      // a ❌ row prints the host's python traceback above it, because a failed execution is
      // loud everywhere else in the library. Here the traceback IS the answer: read the
      // exception, `'T5' object has no attribute 'generate'` means encoder-only
      console.log(`each failure prints its ComfyUI traceback — that is the answer for that model\n`)
      // these run raw workflows rather than the defined one (the model var only offers the
      // generative four), so the connect that DefinedWorkflow.run does is ours to make
      await host.connect()
      const vars = localLlmTextGen.vars
      for (const model of SWEEP_CANDIDATES) {
         // a cold model takes tens of seconds to load: say what is loading, not just what came back
         console.log(`→ ${model}`)
         const workflow = host.workflow({ id: `llm-probe-${model}` })
         buildTextGen(workflow.builder, {
            model,
            instruction: vars.instruction.value,
            subject: vars.subject.value,
            maxLength: vars.maxLength.value,
            temperature: vars.temperature.value,
            repetitionPenalty: vars.repetitionPenalty.value,
            streaming: false,
            seed: vars.seed.value,
            thinking: vars.thinking.value,
         })
         const startedAt = Date.now()
         const execution = await workflow.run({})
         const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
         const text = execution.text
         if (execution.status === 'Failure' || text == null) {
            // an encoder-only model fails HERE, on the host: no `.generate` on a T5/CLIP
            console.log(`❌ ${model} — no generation (${seconds}s)`)
            continue
         }
         const answer = answerOf(text).replaceAll('\n', ' ').trim()
         // it generated, but every token went into an unclosed <think>: a budget problem,
         // not a capability one, and a blank row would read as the opposite
         if (answer.length === 0) console.log(`🟡 ${model} — ${seconds}s, reasoned past the token budget`)
         else console.log(`✅ ${model} — ${seconds}s\n   ${answer.slice(0, 160)}`)
      }
      host.disconnect()
   }
}
