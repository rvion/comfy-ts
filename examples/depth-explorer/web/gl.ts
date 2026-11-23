// raw WebGL2, two views of one map:
//    relief  : a 256² grid displaced by the depth map, textured with the source, drag to orbit
//    relight : the source lit through the normal map, the light follows the pointer
// no 3D library: one mesh, two programs, a few matrix helpers.

const RELIEF_VS = `#version 300 es
in vec2 a_uv;
uniform sampler2D u_depth;
uniform mat4 u_mvp;
uniform float u_scale;
uniform float u_aspect;
out vec2 v_uv;
out vec3 v_pos;
void main() {
   float d = texture(u_depth, a_uv).r;
   v_uv = a_uv;
   v_pos = vec3((a_uv.x - 0.5) * u_aspect, 0.5 - a_uv.y, d * u_scale);
   gl_Position = u_mvp * vec4(v_pos, 1.0);
}`

const RELIEF_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec3 v_pos;
uniform sampler2D u_src;
uniform float u_shade;
out vec4 o;
void main() {
   vec3 n = normalize(cross(dFdx(v_pos), dFdy(v_pos)));
   float lam = clamp(dot(n, normalize(vec3(-0.4, 0.5, 0.8))), 0.0, 1.0);
   vec3 c = texture(u_src, v_uv).rgb;
   o = vec4(mix(c, c * (0.35 + 0.8 * lam), u_shade), 1.0);
}`

const QUAD_VS = `#version 300 es
in vec2 a_uv;
uniform vec2 u_fit;
out vec2 v_uv;
void main() {
   v_uv = a_uv;
   gl_Position = vec4((a_uv.x * 2.0 - 1.0) * u_fit.x, (1.0 - a_uv.y * 2.0) * u_fit.y, 0.0, 1.0);
}`

const RELIGHT_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_src;
uniform sampler2D u_normal;
uniform vec2 u_light;
uniform float u_flipG;
uniform float u_albedo;
out vec4 o;
void main() {
   vec3 n = texture(u_normal, v_uv).rgb * 2.0 - 1.0;
   n.y *= u_flipG;
   n = normalize(n);
   vec3 L = normalize(vec3(u_light, 0.55));
   float lam = max(dot(n, L), 0.0);
   float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 24.0);
   vec3 base = mix(vec3(0.78), texture(u_src, v_uv).rgb, u_albedo);
   o = vec4(base * (0.12 + 1.05 * lam) + 0.25 * spec, 1.0);
}`

type Mat4 = Float32Array

function mul(a: Mat4, b: Mat4): Mat4 {
   const o = new Float32Array(16)
   for (let c = 0; c < 4; c++)
      for (let r = 0; r < 4; r++) {
         let s = 0
         for (let k = 0; k < 4; k++) s += (a[k * 4 + r] ?? 0) * (b[c * 4 + k] ?? 0)
         o[c * 4 + r] = s
      }
   return o
}
function perspective(fovy: number, aspect: number, near: number, far: number): Mat4 {
   const f = 1 / Math.tan(fovy / 2)
   const nf = 1 / (near - far)
   return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0])
}
function rotX(a: number): Mat4 {
   const c = Math.cos(a)
   const s = Math.sin(a)
   return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1])
}
function rotY(a: number): Mat4 {
   const c = Math.cos(a)
   const s = Math.sin(a)
   return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1])
}
function translate(x: number, y: number, z: number): Mat4 {
   return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1])
}

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
   const prog = gl.createProgram()
   for (const [type, src] of [
      [gl.VERTEX_SHADER, vs],
      [gl.FRAGMENT_SHADER, fs],
   ] as const) {
      const sh = gl.createShader(type)
      if (sh == null) throw new Error('createShader failed')
      gl.shaderSource(sh, src)
      gl.compileShader(sh)
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`shader: ${gl.getShaderInfoLog(sh)}`)
      gl.attachShader(prog, sh)
   }
   gl.bindAttribLocation(prog, 0, 'a_uv')
   gl.linkProgram(prog)
   if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`link: ${gl.getProgramInfoLog(prog)}`)
   return prog
}

const GRID = 256

export type GlParams = {
   mode: 'relief' | 'relight'
   yaw: number
   pitch: number
   zoom: number
   depthScale: number
   shade: number
   light: [number, number]
   flipG: boolean
   albedo: boolean
}

export class GlView {
   private gl: WebGL2RenderingContext
   private relief: WebGLProgram
   private relight: WebGLProgram
   private gridVao: WebGLVertexArrayObject
   private quadVao: WebGLVertexArrayObject
   private gridCount: number
   private texSrc: WebGLTexture
   private texMap: WebGLTexture
   private aspect = 1

   constructor(private canvas: HTMLCanvasElement) {
      const gl = canvas.getContext('webgl2', { antialias: true })
      if (gl == null) throw new Error('WebGL2 is not available in this browser')
      this.gl = gl
      this.relief = compile(gl, RELIEF_VS, RELIEF_FS)
      this.relight = compile(gl, QUAD_VS, RELIGHT_FS)

      const uv = new Float32Array((GRID + 1) * (GRID + 1) * 2)
      for (let y = 0; y <= GRID; y++)
         for (let x = 0; x <= GRID; x++) {
            uv[(y * (GRID + 1) + x) * 2] = x / GRID
            uv[(y * (GRID + 1) + x) * 2 + 1] = y / GRID
         }
      const idx = new Uint32Array(GRID * GRID * 6)
      let i = 0
      for (let y = 0; y < GRID; y++)
         for (let x = 0; x < GRID; x++) {
            const a = y * (GRID + 1) + x
            const b = a + 1
            const c = a + GRID + 1
            const d = c + 1
            idx.set([a, c, b, b, c, d], i)
            i += 6
         }
      this.gridCount = idx.length
      this.gridVao = this.vao(uv, idx)
      this.quadVao = this.vao(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), new Uint32Array([0, 2, 1, 1, 2, 3]))
      this.texSrc = this.tex()
      this.texMap = this.tex()
   }

   private vao(uv: Float32Array, idx: Uint32Array): WebGLVertexArrayObject {
      const gl = this.gl
      const vao = gl.createVertexArray()
      gl.bindVertexArray(vao)
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
      gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW)
      gl.enableVertexAttribArray(0)
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer())
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW)
      gl.bindVertexArray(null)
      return vao
   }

   private tex(): WebGLTexture {
      const gl = this.gl
      const t = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, t)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      return t
   }

   /** the source image and the map (grey depth or normal), any sizes: both are sampled by uv */
   setImages(src: TexImageSource, map: TexImageSource, aspect: number): void {
      const gl = this.gl
      this.aspect = aspect
      for (const [t, img] of [
         [this.texSrc, src],
         [this.texMap, map],
      ] as const) {
         gl.bindTexture(gl.TEXTURE_2D, t)
         gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
      }
   }

   draw(p: GlParams): void {
      const gl = this.gl
      const dpr = window.devicePixelRatio || 1
      const w = Math.round(this.canvas.clientWidth * dpr)
      const h = Math.round(this.canvas.clientHeight * dpr)
      if (this.canvas.width !== w || this.canvas.height !== h) {
         this.canvas.width = w
         this.canvas.height = h
      }
      gl.viewport(0, 0, w, h)
      gl.clearColor(0.07, 0.075, 0.085, 1)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, this.texSrc)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, this.texMap)
      const view = w / Math.max(1, h)

      if (p.mode === 'relief') {
         gl.enable(gl.DEPTH_TEST)
         gl.useProgram(this.relief)
         const fit = Math.max(this.aspect, 1)
         const model = mul(rotX(p.pitch), mul(rotY(p.yaw), translate(0, 0, -p.depthScale / 2)))
         const mvp = mul(perspective(0.7, view, 0.05, 20), mul(translate(0, 0, -1.9 * fit * p.zoom), model))
         gl.uniformMatrix4fv(gl.getUniformLocation(this.relief, 'u_mvp'), false, mvp)
         gl.uniform1f(gl.getUniformLocation(this.relief, 'u_scale'), p.depthScale)
         gl.uniform1f(gl.getUniformLocation(this.relief, 'u_aspect'), this.aspect)
         gl.uniform1f(gl.getUniformLocation(this.relief, 'u_shade'), p.shade)
         gl.uniform1i(gl.getUniformLocation(this.relief, 'u_src'), 0)
         gl.uniform1i(gl.getUniformLocation(this.relief, 'u_depth'), 1)
         gl.bindVertexArray(this.gridVao)
         gl.drawElements(gl.TRIANGLES, this.gridCount, gl.UNSIGNED_INT, 0)
         return
      }
      gl.disable(gl.DEPTH_TEST)
      gl.useProgram(this.relight)
      const fx = this.aspect > view ? 1 : this.aspect / view
      const fy = this.aspect > view ? view / this.aspect : 1
      gl.uniform2f(gl.getUniformLocation(this.relight, 'u_fit'), fx, fy)
      gl.uniform2f(gl.getUniformLocation(this.relight, 'u_light'), p.light[0], p.light[1])
      gl.uniform1f(gl.getUniformLocation(this.relight, 'u_flipG'), p.flipG ? -1 : 1)
      gl.uniform1f(gl.getUniformLocation(this.relight, 'u_albedo'), p.albedo ? 1 : 0)
      gl.uniform1i(gl.getUniformLocation(this.relight, 'u_src'), 0)
      gl.uniform1i(gl.getUniformLocation(this.relight, 'u_normal'), 1)
      gl.bindVertexArray(this.quadVao)
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_INT, 0)
   }
}
