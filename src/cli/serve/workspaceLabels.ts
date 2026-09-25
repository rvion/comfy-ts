// the menu column's two read-only cards. PURE, tests/serve-workspace-labels.test.ts.
// the full path is what a click copies; the label is what fits in a 220px card

export type PathLabel = { path: string; label: string }

function tilde(path: string, home: string): string {
   if (home === '' || home === '/') return path
   if (path === home) return '~'
   return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

export function workspaceLabels(p: { workspace: string; root: string; home: string }): {
   workspace: PathLabel
   root: PathLabel
} {
   const ws = p.workspace.replace(/\/+$/, '')
   const root = p.root.replace(/\/+$/, '')
   const rootLabel = root === ws ? '.' : root.startsWith(`${ws}/`) ? root.slice(ws.length + 1) : tilde(root, p.home)
   return {
      workspace: { path: ws, label: tilde(ws, p.home) },
      root: { path: root, label: rootLabel },
   }
}
