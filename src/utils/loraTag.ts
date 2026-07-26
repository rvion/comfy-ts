/**
 * build a LoraManager-style lora tag: `<lora:name:strength>` or
 * `<lora:name:strength:clipStrength>`. Pin the name to a host union for
 * autocomplete + validation:
 *
 *    loraTag<Comfy.Windows1.Union['E_LoraName']>('myLora', 0.8)
 */
export function loraTag<N extends string = string>(name: N, strength: number = 1, clipStrength?: number): string {
   return clipStrength == null ? `<lora:${name}:${strength}>` : `<lora:${name}:${strength}:${clipStrength}>`
}
