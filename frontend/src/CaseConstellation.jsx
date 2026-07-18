// CaseConstellation — pseudo-3D case-state graph for the World Model screen.
// Fibonacci-sphere node placement, matrix rotation + perspective projection,
// outward-bowed bezier edges, auto-orbit + pointer spin. The core is the case state;
// the labeled ring is the evidence sources the engine binds facts to; the
// unlabeled satellites read as the wider belief state. Labels stay at the
// altitude the UI already discloses — no engine internals.
import React, { useEffect, useRef } from 'react'

const R = 96
const CAM = 540
const PRIMARY_LABELS = ['transcript', 'clinical note', 'FHIR chart', 'patient', 'payer policy']

// Design-token palette, hex equivalents of the UI's oklch values.
const INK = '#3a4150'
const MUTED = '#9aa1ad'
const BLUE = '#4059c8'
const BLUE_SOFT = 'rgba(64,89,200,0.32)'
const GREEN = '#3f8f63'
const AMBER = '#c08a3e'

function fib(n, radius, seed = 0) {
  const pts = []
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / Math.max(1, n - 1)) * 2
    const rad = Math.sqrt(Math.max(0, 1 - y * y))
    const t = (i + seed) * golden
    pts.push({ x: Math.cos(t) * rad * radius, y: y * radius, z: Math.sin(t) * rad * radius })
  }
  return pts
}

// Sample the middle latitudes of a 7-point sphere: taking all 5 of fib(5) pins
// the first/last nodes at the exact poles, which renders as a straight vertical
// rod through the core. The interior slice keeps every labeled node off-axis.
const PRIMARY = fib(7, R, 0.5).slice(1, 6).map((p, i) => ({ ...p, label: PRIMARY_LABELS[i], tier: 'primary' }))
const SAT = [...fib(14, R * 1.45, 1.7), ...fib(10, R * 1.75, 4.3)].map((p) => ({ ...p, label: '', tier: 'sat' }))
const NODES = [{ x: 0, y: 0, z: 0, label: 'case state', tier: 'core' }, ...PRIMARY, ...SAT]

// Edges: core -> primaries (spokes) + each satellite -> nearest primary.
const EDGES = []
for (let i = 1; i <= PRIMARY.length; i++) EDGES.push([0, i])
for (let s = 0; s < SAT.length; s++) {
  const si = 1 + PRIMARY.length + s
  let best = 1, bd = Infinity
  for (let p = 1; p <= PRIMARY.length; p++) {
    const d = Math.hypot(NODES[si].x - NODES[p].x, NODES[si].y - NODES[p].y, NODES[si].z - NODES[p].z)
    if (d < bd) { bd = d; best = p }
  }
  EDGES.push([si, best])
}

export default function CaseConstellation({ height = 300, statusColors }) {
  const canvasRef = useRef(null)
  const drag = useRef({ on: false, lastX: 0, lastY: 0, vx: 0.0035, vy: 0.0012, rx: 0.35, ry: 0.6 })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    let raf = 0

    const size = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = canvas.clientWidth
      canvas.width = w * dpr
      canvas.height = height * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    size()
    const ro = new ResizeObserver(size)
    ro.observe(canvas)

    const project = (p, rx, ry, cx, cy) => {
      const cosY = Math.cos(ry), sinY = Math.sin(ry)
      const cosX = Math.cos(rx), sinX = Math.sin(rx)
      let x = p.x * cosY + p.z * sinY
      let z = -p.x * sinY + p.z * cosY
      let y = p.y * cosX - z * sinX
      z = p.y * sinX + z * cosX
      const s = CAM / (CAM + z)
      return { x: cx + x * s, y: cy + y * s, s, z }
    }

    const draw = () => {
      const d = drag.current
      if (!d.on && !reduce) { d.ry += d.vx; d.rx += d.vy * Math.sin(d.ry * 0.7) }
      const w = canvas.clientWidth
      const cx = w / 2, cy = height / 2
      ctx.clearRect(0, 0, w, height)

      const proj = NODES.map((n) => project(n, d.rx, d.ry, cx, cy))

      // instrument rings (backdrop)
      ctx.save()
      ctx.strokeStyle = 'rgba(90,105,140,0.10)'
      for (let i = 0; i < 3; i++) {
        ctx.beginPath()
        ctx.ellipse(cx, cy, R * (1.35 + i * 0.32), R * (0.5 + i * 0.16), (d.ry * (i % 2 ? -0.4 : 0.3)), 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.restore()

      // edges: quadratic beziers bowed outward from the sphere center
      for (const [a, b] of EDGES) {
        const pa = proj[a], pb = proj[b]
        const na = NODES[a], nb = NODES[b]
        const mid = { x: (na.x + nb.x) / 2, y: (na.y + nb.y) / 2, z: (na.z + nb.z) / 2 }
        const ml = Math.hypot(mid.x, mid.y, mid.z) || 1
        const bow = 1 + (a === 0 ? 0.10 : 0.22)
        const mc = project({ x: (mid.x / ml) * ml * bow, y: (mid.y / ml) * ml * bow, z: (mid.z / ml) * ml * bow }, d.rx, d.ry, cx, cy)
        const depth = (pa.s + pb.s) / 2
        ctx.strokeStyle = a === 0 ? BLUE_SOFT : 'rgba(110,120,150,0.16)'
        ctx.lineWidth = a === 0 ? 1.1 * depth : 0.7 * depth
        ctx.beginPath()
        ctx.moveTo(pa.x, pa.y)
        ctx.quadraticCurveTo(mc.x, mc.y, pb.x, pb.y)
        ctx.stroke()
      }

      // nodes, far-to-near for painter's order
      const order = proj.map((p, i) => [p.z, i]).sort((x, y) => y[0] - x[0])
      for (const [, i] of order) {
        const p = proj[i]
        const n = NODES[i]
        if (n.tier === 'core') {
          ctx.fillStyle = BLUE
          ctx.beginPath(); ctx.arc(p.x, p.y, 5.5 * p.s, 0, Math.PI * 2); ctx.fill()
          ctx.strokeStyle = BLUE_SOFT; ctx.lineWidth = 1.4
          ctx.beginPath(); ctx.arc(p.x, p.y, 10 * p.s, 0, Math.PI * 2); ctx.stroke()
        } else if (n.tier === 'primary') {
          const col = (statusColors && statusColors[n.label]) || INK
          ctx.strokeStyle = col; ctx.lineWidth = 2 * p.s
          ctx.beginPath(); ctx.arc(p.x, p.y, 4.2 * p.s, 0, Math.PI * 2); ctx.stroke()
          ctx.fillStyle = '#fff'
          ctx.beginPath(); ctx.arc(p.x, p.y, 2.1 * p.s, 0, Math.PI * 2); ctx.fill()
        } else {
          ctx.fillStyle = `rgba(122,132,158,${0.22 + 0.4 * Math.max(0, p.s - 0.7)})`
          ctx.beginPath(); ctx.arc(p.x, p.y, 1.9 * p.s, 0, Math.PI * 2); ctx.fill()
        }
        if (n.label) {
          ctx.font = `${n.tier === 'core' ? 600 : 500} ${n.tier === 'core' ? 11 : 10}px 'IBM Plex Mono', monospace`
          ctx.fillStyle = n.tier === 'core' ? INK : (p.s > 1 ? INK : MUTED)
          ctx.textAlign = 'center'
          ctx.fillText(n.label, p.x, p.y - (n.tier === 'core' ? 16 : 10) * p.s)
        }
      }

      if (!reduce) raf = requestAnimationFrame(draw)
    }

    const down = (e) => { const d = drag.current; d.on = true; d.lastX = e.clientX; d.lastY = e.clientY }
    const move = (e) => {
      const d = drag.current
      if (!d.on) return
      d.ry += (e.clientX - d.lastX) * 0.006
      d.rx += (e.clientY - d.lastY) * 0.006
      d.lastX = e.clientX; d.lastY = e.clientY
      if (reduce) draw()
    }
    const up = () => { drag.current.on = false }
    canvas.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)

    draw()
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      canvas.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [height, statusColors])

  return <canvas ref={canvasRef} style={{ width: '100%', height, display: 'block', cursor: 'grab', touchAction: 'none' }} aria-label="Case state constellation: evidence sources orbiting the persistent case state" />
}

export { GREEN, AMBER, BLUE }
