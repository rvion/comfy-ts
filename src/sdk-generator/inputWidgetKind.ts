import type { NodeInputExt } from 'src/sdk-generator/comfyui-types.ts'
import { ComfyPrimitiveMapping } from 'src/sdk-generator/Primitives.ts'

/**
 * Widget-ness of a schema input, decided from its CONFIG — never from a
 * type-name whitelist (2026 object_info spells widget inputs as arbitrary
 * strings backed by a frontend widget registry we cannot mirror; every
 * registry spelling carries a config signal instead). Signal precedence and
 * their upstream anchors: agent/architecture.md "Widget-ness is decided from
 * the input CONFIG".
 */
export type InputWidgetKind =
   | { kind: 'slot' }
   | {
        kind: 'widget'
        /** total widgets_values entries this input's run occupies: prefix buttons + value + control phantom */
        consumes: number
        strictValues: boolean
        /**
         * serialized values the frontend addWidget()s BEFORE the real value
         * (button widgets, creation order). Import reads the value at
         * `offset + prefixValues.length`; export writes these literals first
         * so a round-trip through the ComfyUI editor keeps positional
         * alignment. Empty for every config-signalled widget.
         */
        prefixValues: readonly unknown[]
     }
   | { kind: 'dynamic-combo'; options: DynamicComboOption[]; defaultKey: string }
   | { kind: 'dynamic-container'; instanceNames: string[]; requiredCount: number }

/** one raw `[type, opts]` input entry as spelled in object_info (dynamic-combo branches arrive in this raw form) */
export type RawInputSpecEntry = {
   name: string
   type: string | readonly unknown[]
   opts: unknown
   required: boolean
}

export type DynamicComboOption = { key: string; inputs: RawInputSpecEntry[] }

export const isRecord = (x: unknown): x is Record<string, unknown> =>
   typeof x === 'object' && x != null && !Array.isArray(x)

/**
 * seed phantom: a TRUTHY `control_after_generate` adds one consumed value.
 * The frontend creates the control widget on truthiness, and real 2026 hosts
 * spell it as `true` OR as a string mode like `'fixed'` (PrimitiveInt.value,
 * SeedNode.seed). When the KEY is absent (2024 era) the INT-named-seed
 * heuristic applies.
 */
const controlConsumes = (o: Record<string, unknown> | null, typeName: string, name: string): 1 | 2 => {
   if (o != null && 'control_after_generate' in o) return o['control_after_generate'] ? 2 : 1
   if (typeName === 'INT' && (name === 'seed' || name === 'noise_seed')) return 2
   return 1
}

const flattenInputSections = (inputs: Record<string, unknown>): RawInputSpecEntry[] => {
   const out: RawInputSpecEntry[] = []
   for (const section of ['required', 'optional'] as const) {
      const sec = inputs[section]
      if (!isRecord(sec)) continue
      for (const [name, spec] of Object.entries(sec)) {
         if (!Array.isArray(spec) || spec.length === 0) continue
         const t: unknown = spec[0]
         if (typeof t !== 'string' && !Array.isArray(t)) continue
         out.push({ name, type: t, opts: spec[1], required: section === 'required' })
      }
   }
   return out
}

/** null when the options array is NOT the dynamic `{key, inputs}` family (then it is a plain combo) */
const parseDynamicOptions = (options: unknown[]): DynamicComboOption[] | null => {
   if (options.length === 0) return null
   const out: DynamicComboOption[] = []
   for (const entry of options) {
      if (!isRecord(entry)) return null
      const key = entry['key']
      const inputs = entry['inputs']
      if (typeof key !== 'string' || !isRecord(inputs)) return null
      out.push({ key, inputs: flattenInputSections(inputs) })
   }
   return out
}

/**
 * autogrow (`template` WITH a nested `input` section): instances are always
 * link slots named `decl.<name_i>` (the backend force-inputs widget
 * templates), the first `min` of them required WHEN the template input
 * section is `required` — mirrors `_io.py Autogrow._expand_schema_for_dynamic`.
 */
const parseContainer = (template: Record<string, unknown>): InputWidgetKind => {
   const input = template['input']
   const min = typeof template['min'] === 'number' ? template['min'] : 1
   const prefix = typeof template['prefix'] === 'string' ? template['prefix'] : ''
   const max = typeof template['max'] === 'number' ? template['max'] : 100
   const rawNames = template['names']
   const names = Array.isArray(rawNames)
      ? rawNames.filter((n): n is string => typeof n === 'string')
      : Array.from({ length: max }, (_, i) => `${prefix}${i}`)
   const templateRequired = isRecord(input) && isRecord(input['required']) && Object.keys(input['required']).length > 0
   return {
      kind: 'dynamic-container',
      instanceNames: names,
      requiredCount: templateRequired ? Math.min(min, names.length) : 0,
   }
}

/**
 * the single template sub-input's slot type of an autogrow container
 * (`'IMAGE'` for TextEncodeBooguEdit.images). null when opts are not an
 * autogrow template or the template has several sub-inputs (corpus-absent
 * 2026-07-30, 27/27 single on the cloud catalog) — then codegen emits no
 * typed instance keys and the container stays builderBase territory.
 */
export const containerInstanceSlotType = (opts: unknown): string | null => {
   const o = isRecord(opts) ? opts : null
   const template = o?.['template']
   if (!isRecord(template) || !isRecord(template['input'])) return null
   const subs = flattenInputSections(template['input'])
   const first = subs[0]
   if (subs.length !== 1 || first == null || typeof first.type !== 'string') return null
   return first.type
}

/**
 * frontend-registered widgets whose object_info opts carry NO config signal —
 * the one exception to config-only classification (architecture.md rule 8).
 * Every entry must quote the frontend widget-creation source.
 *
 * LOAD_3D (ComfyUI_frontend src/extensions/core/load3d.ts, verified
 * 2026-07-31): the LOAD_3D custom widget handler runs
 *   node.addWidget('button', 'upload 3d model', 'upload3dmodel', …)
 *   node.addWidget('button', 'upload extra resources', 'uploadExtraResources', …)
 *   node.addWidget('button', 'clear', 'clear', …)
 * THEN creates the scene widget, so the serialized run is
 * [btn, btn, btn, value] with the real value LAST. Lax domain: '' in saved
 * files, an {image, mask, normal, camera_info, …} dict at queue time.
 */
const EMPTY_CONFIG_FRONTEND_WIDGETS: Record<string, { prefixValues: readonly unknown[] }> = {
   LOAD_3D: { prefixValues: ['upload3dmodel', 'uploadExtraResources', 'clear'] },
}

export const classifyWidgetInput = (p: {
   name: string
   type: string | readonly unknown[]
   opts: unknown
   /** true when type is a generated `E_*` union name (parsed 2024-era enum) */
   isEnumUnion?: boolean
}): InputWidgetKind => {
   const o = isRecord(p.opts) ? p.opts : null
   // 1. forceInput gates widget creation upstream, whatever the type says
   if (o?.['forceInput'] === true) return { kind: 'slot' }
   // 2. enum arrays / parsed E_ unions are combo widgets
   if (Array.isArray(p.type) || p.isEnumUnion === true) {
      const tn = typeof p.type === 'string' ? p.type : 'COMBO'
      return { kind: 'widget', consumes: controlConsumes(o, tn, p.name), strictValues: true, prefixValues: [] }
   }
   if (typeof p.type !== 'string') return { kind: 'slot' }
   // 3. widgetType names the widget for multi-type unions (frontend: widgets.get(widgetType ?? type))
   const widgetTypeName = typeof o?.['widgetType'] === 'string' ? o['widgetType'] : p.type
   // 4. primitives
   if (ComfyPrimitiveMapping[widgetTypeName] != null)
      return {
         kind: 'widget',
         consumes: controlConsumes(o, widgetTypeName, p.name),
         strictValues: true,
         prefixValues: [],
      }
   // 5. options array: dynamic {key, inputs} family, else plain combo
   const options = o?.['options']
   if (Array.isArray(options)) {
      const dynOptions = parseDynamicOptions(options)
      if (dynOptions != null) {
         const first = dynOptions[0]
         if (first == null) return { kind: 'slot' } // unreachable: parseDynamicOptions rejects empty
         const defaultKey = typeof o?.['default'] === 'string' ? o['default'] : first.key
         return { kind: 'dynamic-combo', options: dynOptions, defaultKey }
      }
      return { kind: 'widget', consumes: controlConsumes(o, p.type, p.name), strictValues: true, prefixValues: [] }
   }
   // 6. template WITH nested input = autogrow container; WITHOUT = matchtype slot typing
   const template = o?.['template']
   if (isRecord(template)) {
      if (isRecord(template['input'])) return parseContainer(template)
      return { kind: 'slot' }
   }
   // 7. socketless: a widget that never has a socket (IMAGECOMPARE, COLOR); value domain unknown
   if (o?.['socketless'] === true) return { kind: 'widget', consumes: 1, strictValues: false, prefixValues: [] }
   // 8. known empty-config frontend widgets (LOAD_3D), the one non-config exception
   const emptyConfigEntry = EMPTY_CONFIG_FRONTEND_WIDGETS[widgetTypeName]
   if (emptyConfigEntry != null)
      return {
         kind: 'widget',
         consumes: emptyConfigEntry.prefixValues.length + 1,
         strictValues: false,
         prefixValues: emptyConfigEntry.prefixValues,
      }
   return { kind: 'slot' }
}

export const classifySchemaInput = (input: NodeInputExt): InputWidgetKind =>
   classifyWidgetInput({
      name: input.nameInComfy,
      type: input.typeName,
      opts: input.opts,
      isEnumUnion: input.isEnum,
   })

/**
 * what ComfyUI's frontend gives a widget created with no serialized value
 * (`getWidgetDefaultValue` semantics), used when a positional array is
 * shorter than the schema's widget list. `null` for custom widgets — the
 * backend accepts an explicit null but errors on an ABSENT required key.
 */
export const defaultValueForWidget = (p: {
   type: string
   opts: unknown
   /** resolved values when the type is a generated E_ union or an inline enum array */
   enumValues?: readonly (string | boolean | number)[]
}): unknown => {
   const o = isRecord(p.opts) ? p.opts : null
   if (o != null && o['default'] !== undefined) return o['default']
   const widgetTypeName = typeof o?.['widgetType'] === 'string' ? o['widgetType'] : p.type
   if (widgetTypeName === 'INT' || widgetTypeName === 'FLOAT') return 0
   if (widgetTypeName === 'BOOLEAN') return false
   if (widgetTypeName === 'STRING') return ''
   const options = o?.['options']
   if (Array.isArray(options) && options.length > 0) {
      const first: unknown = options[0]
      if (typeof first === 'string' || typeof first === 'number' || typeof first === 'boolean') return first
   }
   if (p.enumValues != null && p.enumValues.length > 0) return p.enumValues[0]
   return null
}
