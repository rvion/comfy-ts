"""records a real terminal session as an asciicast v2 file: the command runs in a pty of a fixed size, a script of
keys is typed into it (each step waits for a pattern in the output first), and every byte it prints is kept with
its time. The replay page (term/index.html) plays the file back frame by frame.

   python3 -I rec.py <script.json> <out.cast>

script.json: { "cols": 100, "rows": 24, "cwd": "...", "env": {...}, "cmd": ["bash", ...], "max": 180,
               "steps": [ { "wait": "regex", "pause": 0.4, "type": "text\\r", "cps": 22 } ... ] }
A step with no "type" only waits. The recording ends when the command exits, after the last step's "end" pause,
or at "max" seconds.
"""
import codecs, fcntl, json, os, pty, re, select, signal, struct, sys, termios, time

script = json.load(open(sys.argv[1]))
out = open(sys.argv[2], 'w')
cols, rows = script['cols'], script['rows']
env = {'PATH': os.environ['PATH'], 'HOME': os.environ['HOME'], 'TERM': 'xterm-256color', 'LANG': 'en_US.UTF-8', 'COLUMNS': str(cols), 'LINES': str(rows)}
# "$PATH" in a value is the caller's PATH, so a script can put a folder in front of it
env.update({k: v.replace('$PATH', os.environ['PATH']) for k, v in script.get('env', {}).items()})

pid, fd = pty.fork()
if pid == 0:
   os.chdir(script['cwd'])
   os.execvpe(script['cmd'][0], script['cmd'], env)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
os.kill(pid, signal.SIGWINCH)

out.write(json.dumps({'version': 2, 'width': cols, 'height': rows, 'env': {'TERM': 'xterm-256color'}}) + '\n')
t0 = time.monotonic()
dec = codecs.getincrementaldecoder('utf-8')('replace')
seen = ''  # output since the current step began waiting
alive = True


def pump(timeout):
   """reads what the pty printed within timeout seconds"""
   global seen, alive
   r, _, _ = select.select([fd], [], [], timeout)
   if not r:
      return
   try:
      data = os.read(fd, 65536)
   except OSError:
      alive = False
      return
   if not data:
      alive = False
      return
   text = dec.decode(data)
   if text:
      out.write(json.dumps([round(time.monotonic() - t0, 4), 'o', text]) + '\n')
      seen += text


def wait_for(pattern, cap):
   global seen
   rx = re.compile(pattern)
   end = time.monotonic() + cap
   while alive and not rx.search(seen):
      if time.monotonic() > end:
         raise SystemExit(f'rec: "{pattern}" never printed in {cap} s; last output: {seen[-400:]!r}')
      pump(0.05)


def idle(seconds):
   end = time.monotonic() + seconds
   while alive and time.monotonic() < end:
      pump(min(0.05, max(0.0, end - time.monotonic())))


cap = script.get('max', 180)
for step in script['steps']:
   if 'wait' in step:
      wait_for(step['wait'], step.get('cap', cap))
   seen = ''
   idle(step.get('pause', 0))
   text = step.get('type', '')
   cps = step.get('cps', 0)
   for ch in text:
      os.write(fd, ch.encode())
      if cps:
         idle(1 / cps)
   idle(step.get('end', 0))

if alive and script.get('kill', False):
   os.kill(pid, signal.SIGTERM)
end = time.monotonic() + script.get('drain', 1.5)
while alive and time.monotonic() < end:
   pump(0.05)
out.close()
try:
   os.kill(pid, signal.SIGKILL)
except ProcessLookupError:
   pass
