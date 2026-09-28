// the three media a var can take and an output can be. PURE + dependency-free: the web bundle
// imports it to decide which var a dropped output may land on

export type MediaKind = 'image' | 'audio' | 'video'

export const MEDIA_KINDS: readonly MediaKind[] = ['image', 'audio', 'video']

/** picker defaults per kind, lowercase without dots */
export const DEFAULT_MEDIA_EXTENSIONS: Record<MediaKind, readonly string[]> = {
   image: ['png', 'jpg', 'jpeg', 'webp', 'gif'],
   audio: ['wav', 'flac', 'mp3', 'ogg', 'opus', 'm4a'],
   video: ['mp4', 'webm', 'mov', 'mkv', 'm4v'],
}

const MIMES: Record<string, string> = {
   png: 'image/png',
   jpg: 'image/jpeg',
   jpeg: 'image/jpeg',
   webp: 'image/webp',
   gif: 'image/gif',
   flac: 'audio/flac',
   mp3: 'audio/mpeg',
   opus: 'audio/ogg',
   ogg: 'audio/ogg',
   wav: 'audio/wav',
   m4a: 'audio/mp4',
   aac: 'audio/aac',
   mp4: 'video/mp4',
   m4v: 'video/mp4',
   webm: 'video/webm',
   mov: 'video/quicktime',
   mkv: 'video/x-matroska',
   avi: 'video/x-msvideo',
}

/** video containers an output node can name. An animated webp or gif is an IMAGE: the
 * extension decides, never the `animated` flag */
const VIDEO_EXTENSIONS = new Set(['mp4', 'm4v', 'webm', 'mov', 'mkv', 'avi'])

export function extensionOf(filename: string): string {
   const dot = filename.lastIndexOf('.')
   return dot < 0 ? '' : filename.slice(dot + 1).toLowerCase()
}

export function isVideoFilename(filename: string): boolean {
   return VIDEO_EXTENSIONS.has(extensionOf(filename))
}

export function mediaMime(filename: string): string {
   return MIMES[extensionOf(filename)] ?? 'application/octet-stream'
}
