// the relight renderer, raw WebGL2: one full quad, every pixel lit at its 3D position
//    P = (x · aspect, y, depth · depthScale)   (near = white in the depth map)
// by a point light and up to MAX_MOTES drifting light motes. Normals from the normal map (OpenGL,
// green up), else from the depth gradient. Shadows: a short march through the depth map toward
// each light. Materials: albedo, roughness, metalness and a specular (non diffuse) map, each
// optional. Pure renderer: the widget state owns every parameter.

export const MAX_MOTES = 16

export type RelightMaps = {
   image: TexImageSource
   depth?: TexImageSource
   normal?: TexImageSource
   albedo?: TexImageSource
   roughness?: TexImageSource
   metalness?: TexImageSource
   specular?: TexImageSource
}

export type RelightView = 'lit' | 'albedo' | 'normal' | 'depth' | 'roughness' | 'metalness' | 'specular' | 'shadow'
export const VIEW_INDEX: Record<RelightView, number> = {
   lit: 0,
   albedo: 1,
   normal: 2,
   depth: 3,
   roughness: 4,
   metalness: 5,
   specular: 6,
   shadow: 7,
}

export type RelightParams = {
   /** light position: x, y in 0..1 over the image (y down), z above the surface, in image heights */
   light: [number, number, number]
   color: [number, number, number]
   intensity: number
   /** distance (image heights) where the light falls to half */
   falloff: number
   /** how much of the original photo stays under the new light */
   ambient: number
   depthScale: number
   shadows: boolean
   /** each mote: x, y, z like the light */
   motes: [number, number, number][]
   moteIntensity: number
   /** draw the light and the motes as glowing blobs */
   showLights: boolean
   view: RelightView
   exposure: number
}

const VS = `#version 300 es
in vec2 a_uv;
uniform vec2 u_fit;
out vec2 v_uv;
void main() {
   v_uv = a_uv;
   gl_Position = vec4((a_uv.x * 2.0 - 1.0) * u_fit.x, (1.0 - a_uv.y * 2.0) * u_fit.y, 0.0, 1.0);
}`

const FS = `#version 300 es
precision highp float;
#define MAX_MOTES ${MAX_MOTES}
in vec2 v_uv;
uniform sampler2D u_image, u_depth, u_normal, u_albedo, u_rough, u_metal, u_spec;
uniform bool u_hasDepth, u_hasNormal, u_hasAlbedo, u_hasRough, u_hasMetal, u_hasSpec;
uniform float u_aspect, u_depthScale, u_intensity, u_falloff, u_ambient, u_moteIntensity, u_exposure;
uniform vec3 u_light, u_color;
uniform bool u_shadows, u_showLights;
uniform int u_moteCount, u_view;
uniform vec3 u_motes[MAX_MOTES];
uniform vec2 u_texel;
out vec4 o;

float depthAt(vec2 uv) { return u_hasDepth ? texture(u_depth, uv).r : 0.5; }
vec3 posAt(vec2 uv) { return vec3(uv.x * u_aspect, 1.0 - uv.y, depthAt(uv) * u_depthScale); }
vec3 lightPos(vec3 l) { return vec3(l.x * u_aspect, 1.0 - l.y, l.z); }

vec3 normalAt(vec2 uv) {
   if (u_hasNormal) return normalize(texture(u_normal, uv).rgb * 2.0 - 1.0);
   vec3 px = posAt(uv + vec2(u_texel.x, 0.0)) - posAt(uv - vec2(u_texel.x, 0.0));
   vec3 py = posAt(uv - vec2(0.0, u_texel.y)) - posAt(uv + vec2(0.0, u_texel.y));
   return normalize(cross(px, py));
}

/** 1 = lit, 0 = a surface between P and the light */
float shadow(vec2 uv, vec3 P, vec3 L) {
   if (!u_shadows || !u_hasDepth) return 1.0;
   vec3 d = L - P;
   float occ = 0.0;
   for (int i = 1; i <= 24; i++) {
      float t = float(i) / 24.0;
      vec3 q = P + d * t * 0.9;
      vec2 quv = vec2(q.x / u_aspect, 1.0 - q.y);
      if (quv.x < 0.0 || quv.x > 1.0 || quv.y < 0.0 || quv.y > 1.0) break;
      float h = depthAt(quv) * u_depthScale;
      occ = max(occ, smoothstep(0.004, 0.03, h - q.z));
   }
   return 1.0 - occ;
}

vec3 shade(vec2 uv, vec3 P, vec3 N, vec3 base, float rough, float metal, float specBoost, vec3 Lp, vec3 col, float power) {
   vec3 Lv = Lp - P;
   float dist = length(Lv);
   vec3 L = Lv / dist;
   float att = power / (1.0 + pow(dist / max(u_falloff, 0.01), 2.0));
   float ndl = max(dot(N, L), 0.0);
   vec3 V = vec3(0.0, 0.0, 1.0);
   vec3 H = normalize(L + V);
   float shin = mix(512.0, 6.0, rough);
   float spec = pow(max(dot(N, H), 0.0), shin) * (shin + 8.0) / 25.0;
   vec3 F0 = mix(vec3(0.04), base, metal) * specBoost;
   vec3 diffuse = base * (1.0 - metal) * ndl;
   vec3 specular = F0 * spec * ndl;
   return (diffuse + specular) * col * att * shadow(uv, P, Lp);
}

float glow(vec2 uv, vec3 l, float size) {
   vec2 d = (uv - l.xy) * vec2(u_aspect, 1.0);
   float r = size * (0.6 + 0.6 / (0.3 + l.z));
   return exp(-dot(d, d) / (r * r));
}

void main() {
   vec2 uv = v_uv;
   vec3 photo = texture(u_image, uv).rgb;
   vec3 base = u_hasAlbedo ? texture(u_albedo, uv).rgb : photo;
   float rough = u_hasRough ? texture(u_rough, uv).r : 0.6;
   float metal = u_hasMetal ? texture(u_metal, uv).r : 0.0;
   float specMap = u_hasSpec ? texture(u_spec, uv).r : 0.0;
   vec3 N = normalAt(uv);
   vec3 P = posAt(uv);

   if (u_view == 1) { o = vec4(base, 1.0); return; }
   if (u_view == 2) { o = vec4(N * 0.5 + 0.5, 1.0); return; }
   if (u_view == 3) { o = vec4(vec3(depthAt(uv)), 1.0); return; }
   if (u_view == 4) { o = vec4(vec3(rough), 1.0); return; }
   if (u_view == 5) { o = vec4(vec3(metal), 1.0); return; }
   if (u_view == 6) { o = vec4(vec3(specMap), 1.0); return; }
   if (u_view == 7) { o = vec4(vec3(shadow(uv, P, lightPos(u_light))), 1.0); return; }

   float specBoost = u_hasSpec ? 0.6 + specMap * 6.0 : 1.0;
   vec3 c = photo * u_ambient;
   c += shade(uv, P, N, base, rough, metal, specBoost, lightPos(u_light), u_color, u_intensity);
   for (int i = 0; i < MAX_MOTES; i++) {
      if (i >= u_moteCount) break;
      c += shade(uv, P, N, base, rough, metal, specBoost, lightPos(u_motes[i]), u_color, u_moteIntensity);
   }
   c = vec3(1.0) - exp(-c * u_exposure);
   if (u_showLights) {
      c += u_color * glow(uv, u_light, 0.018) * 1.2;
      for (int i = 0; i < MAX_MOTES; i++) {
         if (i >= u_moteCount) break;
         c += u_color * glow(uv, u_motes[i], 0.006) * 0.9;
      }
   }
   o = vec4(c, 1.0);
}`

const SLOTS = ['image', 'depth', 'normal', 'albedo', 'roughness', 'metalness', 'specular'] as const
type Slot = (typeof SLOTS)[number]
const SAMPLER: Record<Slot, string> = {
   image: 'u_image',
   depth: 'u_depth',
   normal: 'u_normal',
   albedo: 'u_albedo',
   roughness: 'u_rough',
   metalness: 'u_metal',
   specular: 'u_spec',
}
const HAS: Record<Slot, string | null> = {
   image: null,
   depth: 'u_hasDepth',
   normal: 'u_hasNormal',
   albedo: 'u_hasAlbedo',
   roughness: 'u_hasRough',
   metalness: 'u_hasMetal',
   specular: 'u_hasSpec',
}

function compile(gl: WebGL2RenderingContext): WebGLProgram {
   const prog = gl.createProgram()
   for (const [type, src] of [
      [gl.VERTEX_SHADER, VS],
      [gl.FRAGMENT_SHADER, FS],
   ] as const) {
      const sh = gl.createShader(type)
      if (sh == null) throw new Error('relight: createShader failed')
      gl.shaderSource(sh, src)
      gl.compileShader(sh)
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`relight shader: ${gl.getShaderInfoLog(sh)}`)
      gl.attachShader(prog, sh)
   }
   gl.bindAttribLocation(prog, 0, 'a_uv')
   gl.linkProgram(prog)
   if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`relight link: ${gl.getProgramInfoLog(prog)}`)
   return prog
}

export class RelightGl {
   private gl: WebGL2RenderingContext
   private prog: WebGLProgram
   private vao: WebGLVertexArrayObject
   private tex = new Map<Slot, WebGLTexture>()
   private has = new Set<Slot>()
   private aspect = 1
   private texel: [number, number] = [1 / 512, 1 / 512]

   constructor(private canvas: HTMLCanvasElement) {
      const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true })
      if (gl == null) throw new Error('relight needs WebGL2, which this browser does not offer')
      this.gl = gl
      this.prog = compile(gl)
      this.vao = gl.createVertexArray()
      gl.bindVertexArray(this.vao)
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
      gl.enableVertexAttribArray(0)
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
      gl.bindVertexArray(null)
      for (const s of SLOTS) {
         const t = gl.createTexture()
         gl.bindTexture(gl.TEXTURE_2D, t)
         gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
         gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
         gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
         gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
         gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            1,
            1,
            0,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            new Uint8Array([128, 128, 255, 255]),
         )
         this.tex.set(s, t)
      }
   }

   /** the maps, any sizes: each is sampled by uv. `aspect` is the photo's width / height */
   setMaps(maps: RelightMaps, aspect: number, width: number, height: number): void {
      const gl = this.gl
      this.aspect = aspect
      this.texel = [1 / Math.max(1, width), 1 / Math.max(1, height)]
      this.has.clear()
      for (const s of SLOTS) {
         const img = maps[s]
         if (img == null) continue
         gl.bindTexture(gl.TEXTURE_2D, this.tex.get(s) ?? null)
         gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
         this.has.add(s)
      }
   }

   hasMap(s: Slot): boolean {
      return this.has.has(s)
   }

   draw(p: RelightParams): void {
      const gl = this.gl
      const dpr = window.devicePixelRatio || 1
      const w = Math.round(this.canvas.clientWidth * dpr)
      const h = Math.round(this.canvas.clientHeight * dpr)
      if (w === 0 || h === 0) return
      if (this.canvas.width !== w || this.canvas.height !== h) {
         this.canvas.width = w
         this.canvas.height = h
      }
      gl.viewport(0, 0, w, h)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.useProgram(this.prog)
      const u = (name: string): WebGLUniformLocation | null => gl.getUniformLocation(this.prog, name)
      SLOTS.forEach((s, i) => {
         gl.activeTexture(gl.TEXTURE0 + i)
         gl.bindTexture(gl.TEXTURE_2D, this.tex.get(s) ?? null)
         gl.uniform1i(u(SAMPLER[s]), i)
         const flag = HAS[s]
         if (flag != null) gl.uniform1i(u(flag), this.has.has(s) ? 1 : 0)
      })
      // the canvas keeps the photo's aspect (css), so the quad fills it
      gl.uniform2f(u('u_fit'), 1, 1)
      gl.uniform1f(u('u_aspect'), this.aspect)
      gl.uniform2f(u('u_texel'), this.texel[0], this.texel[1])
      gl.uniform1f(u('u_depthScale'), p.depthScale)
      gl.uniform1f(u('u_intensity'), p.intensity)
      gl.uniform1f(u('u_falloff'), p.falloff)
      gl.uniform1f(u('u_ambient'), p.ambient)
      gl.uniform1f(u('u_exposure'), p.exposure)
      gl.uniform1f(u('u_moteIntensity'), p.moteIntensity)
      gl.uniform3f(u('u_light'), p.light[0], p.light[1], p.light[2])
      gl.uniform3f(u('u_color'), p.color[0], p.color[1], p.color[2])
      gl.uniform1i(u('u_shadows'), p.shadows ? 1 : 0)
      gl.uniform1i(u('u_showLights'), p.showLights ? 1 : 0)
      gl.uniform1i(u('u_view'), VIEW_INDEX[p.view])
      const n = Math.min(MAX_MOTES, p.motes.length)
      gl.uniform1i(u('u_moteCount'), n)
      if (n > 0) gl.uniform3fv(u('u_motes'), new Float32Array(p.motes.slice(0, n).flat()))
      gl.bindVertexArray(this.vao)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
   }
}
