/**
 * graph — the decorative Meridian constellation.
 *
 * A deep presentational module: all Three.js lives here, and the public surface is
 * only `mount()` / `GraphHandle.unmount()`. No Three types cross the boundary — the
 * config is primitives + colour strings. A faithful port of meridian-graph-prototype.html
 * (clustered node/edge cloud, additive glow points, warm-accented hubs, the tilted
 * meridian ring), hardened for a long-lived PWA: it disposes every GL resource on
 * unmount, caps DPR, honours reduced-motion, and pauses while the tab is hidden.
 *
 * Zero data dependency — purely visual.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/** Colours as CSS strings (from the design tokens) — no Three types leak out. */
export interface GraphColors {
  core: string;
  hub: string;
  void: string;
  /** solid hue of the edge web (opacity carried separately) */
  edge: string;
  /** solid hue of the meridian ring */
  ring: string;
}

export interface GraphConfig {
  nodeCount: number;
  clusters: number;
  radius: number;
  edgeNeighbors: number;
  bridges: number;
  fog: number;
  pointSize: number;
  autoRotateSpeed: number;
  edgeOpacity: number;
  ringOpacity: number;
  /** attach drag-to-rotate; false leaves the graph a passive background */
  interactive: boolean;
  /** overall brightness multiplier (background preset dims to < 1) */
  dim: number;
  /** opt-in UnrealBloom; off by default (the additive glow already reads right) */
  bloom: boolean;
  /** cap devicePixelRatio; the passive background dims to 1.5 for battery, landing keeps 2 */
  maxDpr?: number;
  colors: GraphColors;
}

export interface GraphHandle {
  /** Tear down: cancel the loop, remove listeners, and dispose ALL GL resources. */
  unmount(): void;
}

interface Node {
  pos: THREE.Vector3;
  cluster: number;
  deg: number;
}

/** Uniform random point on the unit sphere. */
function randDir(): THREE.Vector3 {
  const u = Math.random();
  const v = Math.random();
  const theta = 2 * Math.PI * u;
  const phi = Math.acos(2 * v - 1);
  return new THREE.Vector3(Math.sin(phi) * Math.cos(theta), Math.sin(phi) * Math.sin(theta), Math.cos(phi));
}

/** Soft round glow so nodes read as points of light, not squares. */
function glowSprite(): THREE.Texture {
  const s = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,.85)');
  g.addColorStop(0.55, 'rgba(255,255,255,.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.Texture(cv);
  tex.needsUpdate = true;
  return tex;
}

export function mount(el: HTMLElement, config: GraphConfig): GraphHandle {
  const dim = config.dim;
  const size = (): { w: number; h: number } => ({
    w: el.clientWidth || window.innerWidth,
    h: el.clientHeight || window.innerHeight,
  });

  /* ---- scene / camera / renderer ---- */
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(config.colors.void, config.fog);

  const { w: w0, h: h0 } = size();
  const camera = new THREE.PerspectiveCamera(55, w0 / h0, 1, 600);
  camera.position.set(0, 0, 165);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, config.maxDpr ?? 2));
  renderer.setSize(w0, h0);
  renderer.setClearColor(config.colors.void, 1);
  const canvas = renderer.domElement;
  canvas.style.display = 'block';
  if (!config.interactive) canvas.style.pointerEvents = 'none';
  el.appendChild(canvas);

  const world = new THREE.Group();
  scene.add(world);

  /* ---- clustered graph (communities + a few bridges) ---- */
  const nodes: Node[] = [];
  const clusterCenters: THREE.Vector3[] = [];
  for (let c = 0; c < config.clusters; c++) clusterCenters.push(randDir().multiplyScalar(config.radius));
  for (let i = 0; i < config.nodeCount; i++) {
    const c = Math.floor(Math.random() * config.clusters);
    const jitter = randDir().multiplyScalar(THREE.MathUtils.randFloat(4, config.radius * 0.42));
    nodes.push({ pos: clusterCenters[c].clone().add(jitter), cluster: c, deg: 0 });
  }

  const edges: Array<[number, number]> = [];
  const addEdge = (a: number, b: number): void => {
    edges.push([a, b]);
    nodes[a].deg++;
    nodes[b].deg++;
  };
  for (let i = 0; i < nodes.length; i++) {
    const d = nodes
      .map((n, j) => ({ j, dist: n.pos.distanceTo(nodes[i].pos) }))
      .filter((o) => o.j !== i)
      .sort((a, b) => a.dist - b.dist);
    for (let k = 0; k < config.edgeNeighbors; k++) if (d[k] && i < d[k].j) addEdge(i, d[k].j);
  }
  for (let b = 0; b < config.bridges; b++) {
    addEdge(Math.floor(Math.random() * nodes.length), Math.floor(Math.random() * nodes.length));
  }

  /* ---- nodes: hubs (high degree) get the warm accent + size ---- */
  const degMax = Math.max(1, ...nodes.map((n) => n.deg));
  const posArr = new Float32Array(nodes.length * 3);
  const colArr = new Float32Array(nodes.length * 3);
  const core = new THREE.Color(config.colors.core);
  const hub = new THREE.Color(config.colors.hub);
  nodes.forEach((n, i) => {
    posArr[i * 3] = n.pos.x;
    posArr[i * 3 + 1] = n.pos.y;
    posArr[i * 3 + 2] = n.pos.z;
    const t = n.deg / degMax;
    const col = core.clone().lerp(hub, t * t);
    colArr[i * 3] = col.r;
    colArr[i * 3 + 1] = col.g;
    colArr[i * 3 + 2] = col.b;
  });
  const nodeGeo = new THREE.BufferGeometry();
  nodeGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  nodeGeo.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
  const sprite = glowSprite();
  const nodeMat = new THREE.PointsMaterial({
    size: config.pointSize,
    map: sprite,
    vertexColors: true,
    transparent: true,
    opacity: dim,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
    fog: true,
  });
  world.add(new THREE.Points(nodeGeo, nodeMat));

  /* ---- edges: one faint additive web ---- */
  const eArr = new Float32Array(edges.length * 6);
  edges.forEach((e, i) => {
    const a = nodes[e[0]].pos;
    const b = nodes[e[1]].pos;
    eArr.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
  });
  const edgeGeo = new THREE.BufferGeometry();
  edgeGeo.setAttribute('position', new THREE.BufferAttribute(eArr, 3));
  const edgeMat = new THREE.LineBasicMaterial({
    color: config.colors.edge,
    transparent: true,
    opacity: config.edgeOpacity * dim,
    fog: true,
  });
  world.add(new THREE.LineSegments(edgeGeo, edgeMat));

  /* ---- signature: the tilted meridian ring ---- */
  const ringPts: THREE.Vector3[] = [];
  const RR = config.radius * 1.5;
  for (let a = 0; a <= 128; a++) {
    const t = (a / 128) * Math.PI * 2;
    ringPts.push(new THREE.Vector3(Math.cos(t) * RR, 0, Math.sin(t) * RR));
  }
  const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPts);
  const ringMat = new THREE.LineBasicMaterial({
    color: config.colors.ring,
    transparent: true,
    opacity: config.ringOpacity * dim,
    fog: true,
  });
  const ring = new THREE.LineLoop(ringGeo, ringMat);
  ring.rotation.x = 0.38;
  world.add(ring);

  /* ---- optional bloom (opt-in) ---- */
  let composer: EffectComposer | null = null;
  let bloomPass: UnrealBloomPass | null = null;
  if (config.bloom) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloomPass = new UnrealBloomPass(new THREE.Vector2(w0, h0), 0.7, 0.6, 0.2);
    composer.addPass(bloomPass);
  }

  /* ---- drag-to-rotate with inertia ---- */
  let dragging = false;
  let px = 0;
  let py = 0;
  let velX = 0;
  let velY = 0;
  const off: Array<() => void> = [];
  const on = (
    target: Window | HTMLElement | Document,
    type: string,
    fn: (e: Event) => void,
    opts?: AddEventListenerOptions,
  ): void => {
    target.addEventListener(type, fn as EventListener, opts);
    off.push(() => target.removeEventListener(type, fn as EventListener, opts));
  };

  const point = (e: Event): { x: number; y: number } => {
    const te = e as TouchEvent;
    const t = te.touches && te.touches.length ? te.touches[0] : (e as unknown as MouseEvent);
    return { x: t.clientX, y: t.clientY };
  };
  const down = (e: Event): void => {
    dragging = true;
    const p = point(e);
    px = p.x;
    py = p.y;
  };
  const move = (e: Event): void => {
    if (!dragging) return;
    const p = point(e);
    velY += (p.x - px) * 0.00035;
    velX += (p.y - py) * 0.00035;
    px = p.x;
    py = p.y;
  };
  const up = (): void => {
    dragging = false;
  };
  if (config.interactive) {
    on(canvas, 'mousedown', down);
    on(window, 'mousemove', move);
    on(window, 'mouseup', up);
    on(canvas, 'touchstart', down, { passive: true });
    on(window, 'touchmove', move, { passive: true });
    on(window, 'touchend', up);
  }

  /* ---- reduced motion (stop the drift; keep drag) ---- */
  const rm = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduce = rm.matches;
  const rmChange = (): void => {
    reduce = rm.matches;
    if (!reduce) start(); // motion re-enabled: resume the drift loop
  };
  rm.addEventListener('change', rmChange);
  off.push(() => rm.removeEventListener('change', rmChange));

  /* ---- responsive framing: dolly back on narrow viewports ---- */
  const fitView = (): void => {
    const { w, h } = size();
    camera.aspect = w / h;
    const base = 170;
    camera.position.z = w < 700 ? base * (1 + ((700 - w) / 700) * 0.6) : base;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer?.setSize(w, h);
    if (composer) composer.render();
    else renderer.render(scene, camera);
  };
  fitView();
  on(window, 'resize', fitView);

  /* ---- render loop (paused when tab hidden) ---- */
  let raf = 0;
  const tick = (): void => {
    if (!reduce) world.rotation.y += config.autoRotateSpeed;
    world.rotation.y += velY;
    world.rotation.x += velX;
    world.rotation.x = Math.max(-0.6, Math.min(0.6, world.rotation.x));
    velX *= 0.94;
    velY *= 0.94;
    if (!reduce) ring.rotation.z += 0.0005;
    if (composer) composer.render();
    else renderer.render(scene, camera);
    // A passive (non-interactive) graph under reduced motion has nothing left to
    // animate once drift is off: paint one static frame, then idle instead of
    // holding a rAF slot every frame for an unchanging image. The landing stays
    // interactive, so it keeps looping for drag inertia.
    raf = reduce && !config.interactive ? 0 : requestAnimationFrame(tick);
  };
  const start = (): void => {
    if (!raf) tick();
  };
  const stop = (): void => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };
  const onVisibility = (): void => {
    if (document.hidden) stop();
    else start();
  };
  on(document, 'visibilitychange', onVisibility);
  start();

  return {
    unmount(): void {
      stop();
      for (const removeListener of off) removeListener();
      nodeGeo.dispose();
      nodeMat.dispose();
      sprite.dispose();
      edgeGeo.dispose();
      edgeMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      bloomPass?.dispose?.();
      composer?.dispose?.();
      renderer.dispose();
      renderer.forceContextLoss();
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    },
  };
}
