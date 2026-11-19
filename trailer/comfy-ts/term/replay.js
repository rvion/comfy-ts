// replays a recorded terminal session (an asciicast v2 file from rec.py) frame by frame: window.__trailerStep(t)
// writes every byte printed by cast time from + t * speed (gaps longer than idle shortened to idle), and returns once
// xterm.js drew them, inline images included (the image addon reads the OSC 1337 the TUI prints).
//   index.html?cast=casts/run.cast&from=0&speed=1&idle=0.6&title=my-project
const q = new URLSearchParams(location.search)
const mark = (s) => document.querySelector('meta[name=shot-ready]').setAttribute('content', s)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const frame = () => new Promise((r) => requestAnimationFrame(() => r()))

let term
let events = []
let next = 0
const from = Number(q.get('from') ?? 0)
const speed = Number(q.get('speed') ?? 1)
const idle = Number(q.get('idle') ?? 1e9)

const write = (data) => new Promise((r) => term.write(data, r))

window.__trailerStep = async (t) => {
   const c = from + t * speed
   let images = false
   while (next < events.length && events[next].t <= c) {
      images ||= events[next].data.includes('\u001b]1337;')
      await write(events[next].data)
      next++
   }
   await frame()
   if (images) {
      // the addon decodes an inline image off the write path
      await sleep(120)
      await frame()
   }
}

;(async () => {
   try {
      const lines = (await (await fetch(`/${q.get('cast')}`)).text()).trim().split('\n')
      const head = JSON.parse(lines[0])
      let last = 0
      let shift = 0
      for (const l of lines.slice(1)) {
         const [at, kind, data] = JSON.parse(l)
         if (kind !== 'o') continue
         const gap = at - last
         if (gap > idle) shift += gap - idle
         last = at
         events.push({ t: at - shift, data })
      }
      // trickle=<lines a second>: a burst printed at once (a long listing) is spread line by line from its time, as a
      // slow terminal would print it, so the eye sees it scroll
      const trickle = Number(q.get('trickle') ?? 0)
      if (trickle > 0) {
         const spread = []
         for (const e of events) {
            const parts = e.data.split(/(?<=\n)/)
            if (parts.length < 4) spread.push(e)
            else parts.forEach((data, i) => spread.push({ t: e.t + i / trickle, data }))
         }
         events = spread
         let at = 0
         for (const e of events) at = e.t = Math.max(e.t, at)
      }
      document.getElementById('title').textContent = q.get('title') ?? 'terminal'
      await document.fonts.load("16px 'JetBrains Mono'")
      await document.fonts.load("bold 16px 'JetBrains Mono'")
      const box = document.getElementById('term').getBoundingClientRect()
      const fontSize = Math.floor(Math.min(box.width / (head.width * 0.602), box.height / (head.height * 1.18)) * 10) / 10
      term = new Terminal({
         cols: head.width,
         rows: head.height,
         fontFamily: "'JetBrains Mono', monospace",
         fontSize,
         lineHeight: 1.12,
         cursorBlink: false,
         allowProposedApi: true,
         scrollback: 0,
         theme: { background: '#0d1626', foreground: '#c9d6ee', cursor: '#6da2ee', brightBlack: '#5b6b88' },
      })
      term.loadAddon(new ImageAddon.ImageAddon({ iipSupport: true, sixelSupport: false }))
      term.open(document.getElementById('term'))
      // the cast's state at `from`, written before the first frame
      while (next < events.length && events[next].t <= from) await write(events[next++].data)
      await frame()
      mark('ready')
   } catch (e) {
      document.body.insertAdjacentHTML('beforeend', `<pre style="position:absolute;top:0;left:0;color:#f66;font:14px monospace">${String(e?.stack ?? e)}</pre>`)
      mark('ready')
   }
})()
