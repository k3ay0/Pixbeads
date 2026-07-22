<template>
  <div ref="containerRef" class="w-full h-full relative overflow-hidden v-theme-bg0">
    <canvas ref="canvasRef" class="w-full h-full block" />

    <!-- Camera cube orientation widget (top-right) -->
    <canvas ref="camCubeRef" class="absolute top-1.5 right-1.5 w-[50px] h-[50px] cursor-pointer z-10 rounded"
      style="background: rgba(0,0,0,0.3)" />

    <!-- Wireframe toggle button -->
    <button
      class="absolute top-1.5 right-16 v-theme-bg3 v-theme-text text-xs px-2 py-1 rounded z-10 opacity-90 hover:opacity-100"
      @click="toggleWireframe">
      &#x25A6; 线框
    </button>

    <!-- Camera position overlay (bottom-right) -->
    <div class="absolute bottom-6 right-2 v-theme-bg2 v-theme-text rounded-lg p-2 z-10 text-xs" style="border: 1px solid var(--bd)">
      <div class="flex gap-1 items-center mb-1">
        <label class="v-theme-text3 w-3">X</label>
        <input type="number" :value="camTargetX"
          class="w-10 rounded px-1 v-theme-text v-theme-accent text-xs text-center font-mono"
          style="border: 1px solid var(--bd); background-color: var(--b3)"
          @input="updateCamTarget('x', +($event.target as HTMLInputElement).value)" />
        <label class="v-theme-text3 w-3">Y</label>
        <input type="number" :value="camTargetY"
          class="w-10 rounded px-1 v-theme-text v-theme-accent text-xs text-center font-mono"
          style="border: 1px solid var(--bd); background-color: var(--b3)"
          @input="updateCamTarget('y', +($event.target as HTMLInputElement).value)" />
        <label class="v-theme-text3 w-3">Z</label>
        <input type="number" :value="camTargetZ"
          class="w-10 rounded px-1 v-theme-text v-theme-accent text-xs text-center font-mono"
          style="border: 1px solid var(--bd); background-color: var(--b3)"
          @input="updateCamTarget('z', +($event.target as HTMLInputElement).value)" />
      </div>
      <button class="w-full v-theme-bg3 hover:v-theme-bg4 rounded text-xs py-0.5 mt-1 v-theme-text"
        @click="resetCamera">
        &#x1F504; 重置
      </button>
    </div>

    <!-- Floating cancel button (visible when 2-click tool anchor is active) -->
    <button v-if="showCancelBtn"
      class="absolute top-20 left-1/2 -translate-x-1/2 bg-red-600/90 text-white border border-red-400 rounded-full px-6 py-2 text-sm font-bold z-50 shadow-lg hover:bg-red-700 cursor-pointer"
      @click="cancelAnchor">
      &#x2715; 取消
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { useVoxelStore } from '@/stores/voxelStore'
import { useVoxelGeometry } from '@/composables/useVoxelGeometry'
import { useVoxelInteraction, type ToolActionCallback } from '@/composables/useVoxelInteraction'
import { useVoxelHistory, type VoxelAction } from '@/composables/useVoxelHistory'

const store = useVoxelStore()

const containerRef = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const camCubeRef = ref<HTMLCanvasElement | null>(null)

// ============================================================
// Mutable refs (not reactive — managed imperatively)
// ============================================================
let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let controls: OrbitControls | null = null
let gridGroup: THREE.Group | null = null
let resizeObserver: ResizeObserver | null = null
let detachEvents: (() => void) | null = null
let interaction: ReturnType<typeof useVoxelInteraction> | null = null

// ============================================================
// Reactive overlay state
// ============================================================
const showCancelBtn = ref(false)
const camTargetX = ref(0)
const camTargetY = ref(0)
const camTargetZ = ref(0)

// ============================================================
// Geometry composable (creates voxelGroup + ghostGroup)
// ============================================================
const {
  voxelGroup,
  ghostGroup,
  meshMap,
  addMesh,
  removeMesh,
  rebuildAllMeshes,
  clearGhost,
  disposeAll: disposeGeometry,
  maybeSwitchToInstanced,
  toggleWireframe,
  getDirectionRotation,
  getMeshPosition,
} = useVoxelGeometry()

// ============================================================
// History composable
// ============================================================
const { pushUndo } = useVoxelHistory()

// ============================================================
// onToolAction — called by useVoxelInteraction on tool commit
// ============================================================
const onToolAction: ToolActionCallback = (tool, positions, color, mode) => {
  const actions: VoxelAction[] = []

  for (const pos of positions) {
    const result = store.doVoxel(pos.x, pos.y, pos.z, color, mode, store.currentDirection)
    if (!result) continue // out of bounds or no-op

    // Record for undo
    actions.push({
      x: pos.x,
      y: pos.y,
      z: pos.z,
      prev: result.prev,
      next: result.next,
    })

    // Update 3D mesh
    if (result.next) {
      // Add or update existing mesh
      const key = store.vk(pos.x, pos.y, pos.z)
      const mesh = meshMap.get(key)
      if (mesh) {
        const mat = mesh.material as THREE.MeshStandardMaterial
        mat.color.set(result.next.color)
        mat.opacity = (result.next.alpha ?? 255) / 255
        mat.transparent = (result.next.alpha ?? 255) < 255
        // Update rotation and position based on direction
        const direction = result.next.direction ?? 'y'
        const rot = getDirectionRotation(direction)
        mesh.rotation.set(rot.x, rot.y, rot.z)
        const meshPos = getMeshPosition(pos.x, pos.y, pos.z, direction)
        mesh.position.set(meshPos.x, meshPos.y, meshPos.z)
      } else {
        addMesh(pos.x, pos.y, pos.z, result.next.color, result.next.alpha ?? 255, result.next.direction ?? 'y')
      }
    } else if (result.prev && !result.next) {
      // Delete
      removeMesh(pos.x, pos.y, pos.z)
    }
  }

  // Save to undo history as a single batch
  if (actions.length > 0) {
    pushUndo(actions, tool)
  }

  // Check if InstancedMesh optimization is warranted
  maybeSwitchToInstanced()
}

// ============================================================
// rebuildGrid — floor grid + bounding box + slice plane + symmetry axes
// ============================================================
function rebuildGrid(): void {
  if (!scene) return

  // Dispose old grid
  if (gridGroup) {
    scene.remove(gridGroup)
    gridGroup.traverse((c) => {
      if (c instanceof THREE.Mesh || c instanceof THREE.Line || c instanceof THREE.LineSegments) {
        c.geometry?.dispose()
        if (Array.isArray(c.material)) {
          c.material.forEach((m) => m.dispose())
        } else {
          c.material?.dispose()
        }
      }
    })
  }

  gridGroup = new THREE.Group()
  gridGroup.name = 'workspaceGrid'

  const W = store.dimW
  const H = store.dimH
  const D = store.dimD

  // 1. Floor grid lines (XZ plane at Y=0)
  const floorMat = new THREE.LineBasicMaterial({
    color: 0x334466,
    transparent: true,
    opacity: 0.4,
  })
  for (let i = 0; i <= W; i++) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(i, 0, 0),
      new THREE.Vector3(i, 0, D),
    ])
    gridGroup.add(new THREE.Line(geo, floorMat))
  }
  for (let i = 0; i <= D; i++) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, i),
      new THREE.Vector3(W, 0, i),
    ])
    gridGroup.add(new THREE.Line(geo, floorMat))
  }

  // 2. Bounding box edges
  const boxGeo = new THREE.BoxGeometry(W, H, D)
  const boxEdges = new THREE.EdgesGeometry(boxGeo)
  const boxLine = new THREE.LineSegments(
    boxEdges,
    new THREE.LineBasicMaterial({
      color: 0x445566,
      transparent: true,
      opacity: 0.5,
    }),
  )
  boxLine.position.set(W / 2, H / 2, D / 2)
  gridGroup.add(boxLine)
  boxGeo.dispose()

  // 3. Slice plane (shows current editing layer)
  const currentAxis = store.currentAxis
  const sliceIdx = store.currentZ
  const sliceMat = new THREE.MeshBasicMaterial({
    color: 0x00d4f0,
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide,
    depthWrite: false,
  })

  let sliceGeo: THREE.PlaneGeometry
  const slicePlane = new THREE.Mesh()

  if (currentAxis === 'y') {
    // XZ plane at Y = sliceIdx
    sliceGeo = new THREE.PlaneGeometry(W, D)
    slicePlane.geometry = sliceGeo
    slicePlane.material = sliceMat
    slicePlane.rotation.x = -Math.PI / 2
    slicePlane.position.set(W / 2, sliceIdx + 0.5, D / 2)
  } else if (currentAxis === 'z') {
    // XY plane at Z = sliceIdx
    sliceGeo = new THREE.PlaneGeometry(W, H)
    slicePlane.geometry = sliceGeo
    slicePlane.material = sliceMat
    slicePlane.position.set(W / 2, H / 2, sliceIdx + 0.5)
  } else {
    // YZ plane at X = sliceIdx
    sliceGeo = new THREE.PlaneGeometry(D, H)
    slicePlane.geometry = sliceGeo
    slicePlane.material = sliceMat
    slicePlane.rotation.y = Math.PI / 2
    slicePlane.position.set(sliceIdx + 0.5, H / 2, D / 2)
  }
  slicePlane.name = 'slicePlane'
  gridGroup.add(slicePlane)

  // 4. Symmetry axes (if enabled)
  const symMat = new THREE.LineBasicMaterial({
    color: 0xff3070,
    transparent: true,
    opacity: 0.6,
  })
  if (store.mirrorX) {
    const cx = store.mirrorCenterX
    const pts = [
      new THREE.Vector3(cx, 0, 0),
      new THREE.Vector3(cx, H, 0),
      new THREE.Vector3(cx, H, D),
      new THREE.Vector3(cx, 0, D),
      new THREE.Vector3(cx, 0, 0),
    ]
    gridGroup.add(
      new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), symMat),
    )
  }
  if (store.mirrorY) {
    const cy = store.mirrorCenterY
    const pts = [
      new THREE.Vector3(0, cy, 0),
      new THREE.Vector3(W, cy, 0),
      new THREE.Vector3(W, cy, D),
      new THREE.Vector3(0, cy, D),
      new THREE.Vector3(0, cy, 0),
    ]
    gridGroup.add(
      new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), symMat),
    )
  }
  if (store.mirrorZ) {
    const cz = store.mirrorCenterZ
    const pts = [
      new THREE.Vector3(0, 0, cz),
      new THREE.Vector3(W, 0, cz),
      new THREE.Vector3(W, H, cz),
      new THREE.Vector3(0, H, cz),
      new THREE.Vector3(0, 0, cz),
    ]
    gridGroup.add(
      new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), symMat),
    )
  }
  if (store.mirrorPoint) {
    const sp = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 6, 6),
      new THREE.MeshBasicMaterial({
        color: 0xf0a020,
        transparent: true,
        opacity: 0.6,
      }),
    )
    sp.position.set(store.mirrorCenterX, store.mirrorCenterY, store.mirrorCenterZ)
    gridGroup.add(sp)
  }

  scene.add(gridGroup)
}

// ============================================================
// drawCameraCube — orientation widget in top-right corner
// ============================================================
function drawCameraCube(): void {
  if (!camCubeRef.value || !camera) return
  const cv = camCubeRef.value
  cv.width = 50
  cv.height = 50
  const ctx = cv.getContext('2d')!
  const cx = 25
  const cy = 25

  const dir = new THREE.Vector3()
    .subVectors(camera.position, controls!.target)
    .normalize()

  const faces: { n: [number, number, number]; l: string; c: string }[] = [
    { n: [0, 0, 1], l: 'F', c: '#4488cc' },
    { n: [0, 0, -1], l: 'B', c: '#cc8844' },
    { n: [1, 0, 0], l: 'R', c: '#44cc88' },
    { n: [-1, 0, 0], l: 'L', c: '#cc4488' },
    { n: [0, 1, 0], l: 'T', c: '#88cc44' },
    { n: [0, -1, 0], l: 'D', c: '#8844cc' },
  ]

  faces
    .sort(
      (a, b) =>
        a.n[0] * dir.x +
        a.n[1] * dir.y +
        a.n[2] * dir.z -
        (b.n[0] * dir.x + b.n[1] * dir.y + b.n[2] * dir.z),
    )
    .forEach((f) => {
      const dot = f.n[0] * dir.x + f.n[1] * dir.y + f.n[2] * dir.z
      if (dot < 0) return
      const px = cx + f.n[0] * 14 - f.n[2] * 9
      const py = cy - f.n[1] * 14 - f.n[2] * 5
      ctx.globalAlpha = 0.3 + dot * 0.5
      ctx.fillStyle = f.c
      ctx.beginPath()
      ctx.arc(px, py, 8, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.fillStyle = '#fff'
      ctx.font = 'bold 7px monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(f.l, px, py)
    })
}

// ============================================================
// setCameraView — snap to axis-aligned view
// ============================================================
function setCameraView(view: string): void {
  if (!camera || !controls) return
  const dist = camera.position.distanceTo(controls.target)
  const t = controls.target.clone()
  let dir: THREE.Vector3
  switch (view) {
    case 'top':
      dir = new THREE.Vector3(0, 1, 0)
      break
    case 'bottom':
      dir = new THREE.Vector3(0, -1, 0)
      break
    case 'front':
      dir = new THREE.Vector3(0, 0, 1)
      break
    case 'back':
      dir = new THREE.Vector3(0, 0, -1)
      break
    case 'right':
      dir = new THREE.Vector3(1, 0, 0)
      break
    case 'left':
      dir = new THREE.Vector3(-1, 0, 0)
      break
    default:
      return
  }
  camera.position.copy(t.clone().add(dir.multiplyScalar(dist)))
  controls.update()
}

// ============================================================
// updateCamTarget — handle camera target input changes
// ============================================================
function updateCamTarget(axis: 'x' | 'y' | 'z', value: number): void {
  if (axis === 'x') camTargetX.value = value
  if (axis === 'y') camTargetY.value = value
  if (axis === 'z') camTargetZ.value = value
  // 更新 OrbitControls target
  if (controls) {
    controls.target.set(camTargetX.value, camTargetY.value, camTargetZ.value)
    controls.update()
  }
}

// ============================================================
// resetCamera — reset position and target to initial isometric
// ============================================================
function resetCamera(): void {
  if (!camera || !controls) return
  const w = store.dimW
  const h = store.dimH
  const d = store.dimD

  // Same defaults as index.html resetCam()
  const cTheta = Math.PI / 4
  const cPhi = Math.PI / 4
  const cDist = Math.max(w, h, d) * 2.2
  const targetX = w / 2
  const targetY = h / 4
  const targetZ = d / 2

  camera.position.set(
    targetX + cDist * Math.sin(cPhi) * Math.cos(cTheta),
    targetY + cDist * Math.cos(cPhi),
    targetZ + cDist * Math.sin(cPhi) * Math.sin(cTheta)
  )
  controls.target.set(targetX, targetY, targetZ)
  controls.update()
}

// ============================================================
// initScene
// ============================================================
function initScene(): void {
  if (!canvasRef.value || !containerRef.value) return

  // --- Renderer ---
  renderer = new THREE.WebGLRenderer({
    canvas: canvasRef.value,
    antialias: true,
    alpha: false,
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setClearColor(0xffffff)

  // --- Scene ---
  scene = new THREE.Scene()

  // --- Camera (isometric-like initial position, matching index.html defaults) ---
  const w = store.dimW
  const h = store.dimH
  const d = store.dimD
  const aspect =
    containerRef.value.clientWidth /
    Math.max(containerRef.value.clientHeight, 1)
  camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 500)

  // Same defaults as index.html resetCam(): θ=PI/4, φ=PI/4, distance=max(W,H,D)*2.2, target=(W/2, H/4, D/2)
  const cTheta = Math.PI / 4
  const cPhi = Math.PI / 4
  const cDist = Math.max(w, h, d) * 2.2
  const targetX = w / 2
  const targetY = h / 4
  const targetZ = d / 2

  camera.position.set(
    targetX + cDist * Math.sin(cPhi) * Math.cos(cTheta),
    targetY + cDist * Math.cos(cPhi),
    targetZ + cDist * Math.sin(cPhi) * Math.sin(cTheta)
  )
  camera.lookAt(targetX, targetY, targetZ)

  // --- OrbitControls ---
  controls = new OrbitControls(camera, renderer.domElement)
  controls.target.set(targetX, targetY, targetZ)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.minDistance = 3
  controls.maxDistance = 200
  controls.update()

  // --- Lights ---
  const ambient = new THREE.AmbientLight(0xffffff, 0.55)
  scene.add(ambient)

  const dir1 = new THREE.DirectionalLight(0xffffff, 0.6)
  dir1.position.set(40, 60, 40)
  scene.add(dir1)

  const dir2 = new THREE.DirectionalLight(0x6688ff, 0.2)
  dir2.position.set(-20, 10, -20)
  scene.add(dir2)

  // --- Voxel groups ---
  scene.add(voxelGroup)
  scene.add(ghostGroup)

  // --- Grid (detailed: floor + bounding box + slice plane + symmetry axes) ---
  rebuildGrid()

  // --- Initial mesh rebuild from store ---
  rebuildAllMeshes()

  // --- Interaction (tool dispatch + ghost preview) ---
  interaction = useVoxelInteraction(
    canvasRef.value!,
    camera!,
    voxelGroup,
    ghostGroup,
    onToolAction,
  )
  interaction.attachEvents()
  detachEvents = interaction.detachEvents

  // --- Watch anchor for cancel button ---
  watch(
    () => interaction?.anchor.value ?? null,
    (val) => {
      showCancelBtn.value = val !== null
    },
  )

  // --- Size ---
  updateSize()

  // --- Start animation loop ---
  renderer.setAnimationLoop(animate)
}

// ============================================================
// animate
// ============================================================
function animate(): void {
  if (!renderer || !scene || !camera) return
  controls?.update()

  // Update camera cube widget
  drawCameraCube()

  // Update camera position overlay values
  if (controls) {
    camTargetX.value = Math.round(controls.target.x)
    camTargetY.value = Math.round(controls.target.y)
    camTargetZ.value = Math.round(controls.target.z)
  }

  renderer.render(scene, camera)
}

// ============================================================
// updateSize
// ============================================================
function updateSize(): void {
  if (!containerRef.value || !renderer || !camera) return
  const w = containerRef.value.clientWidth
  const h = containerRef.value.clientHeight
  if (w === 0 || h === 0) return
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}

// ============================================================
// dispose (full cleanup — called by App.vue on mode switch)
// ============================================================
function dispose(): void {
  // Stop the animation loop first
  if (renderer) {
    renderer.setAnimationLoop(null)
  }

  // Detach interaction events
  detachEvents?.()

  // Dispose composable-held geometry / materials / meshes
  disposeGeometry()

  // Dispose grid group
  if (gridGroup) {
    scene?.remove(gridGroup)
    gridGroup.traverse((c) => {
      if (c instanceof THREE.Mesh || c instanceof THREE.Line || c instanceof THREE.LineSegments) {
        c.geometry?.dispose()
        if (Array.isArray(c.material)) {
          c.material.forEach((m) => m.dispose())
        } else {
          c.material?.dispose()
        }
      }
    })
    gridGroup = null
  }

  // Dispose remaining scene objects (lights)
  if (scene) {
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry?.dispose()
        const materials = Array.isArray(obj.material)
          ? obj.material
          : [obj.material]
        for (const mat of materials) {
          mat?.dispose()
        }
      }
    })
  }

  // Dispose controls and renderer
  controls?.dispose()
  renderer?.dispose()

  // Disconnect resize observer
  resizeObserver?.disconnect()

  // Null out refs
  renderer = null
  scene = null
  camera = null
  controls = null
  gridGroup = null
}

// ============================================================
// cancelAnchor — exposed for template button + external call
// ============================================================
function cancelAnchor(): void {
  if (interaction?.anchor.value) {
    interaction.anchor.value = null
    clearGhost()
  }
}

// ============================================================
// Lifecycle
// ============================================================
onMounted(() => {
  initScene()

  // Camera cube click handler — snap to axis-aligned views
  camCubeRef.value?.addEventListener('click', (e) => {
    const rect = camCubeRef.value!.getBoundingClientRect()
    const x = e.clientX - rect.left - 25
    const y = e.clientY - rect.top - 25
    if (Math.abs(x) < 8 && y < -5) {
      setCameraView('top')
    } else if (Math.abs(x) < 8 && y > 5) {
      setCameraView('bottom')
    } else if (x > 5) {
      setCameraView('right')
    } else if (x < -5) {
      setCameraView('left')
    } else {
      setCameraView('front')
    }
  })

  if (containerRef.value) {
    resizeObserver = new ResizeObserver(() => updateSize())
    resizeObserver.observe(containerRef.value)
  }

  // Touch support for 3D canvas
  const canvas3d = canvasRef.value
  if (canvas3d) {
    let lastTouch: { x: number; y: number } | null = null
    let touchDistance = 0

    canvas3d.addEventListener('touchstart', (e: TouchEvent) => {
      e.preventDefault()
      if (e.touches.length === 1) {
        // 1 finger: tool operation
        const t = e.touches[0]
        lastTouch = { x: t.clientX, y: t.clientY }
        // Dispatch as pointer event for interaction handler
        const evt = new PointerEvent('pointerdown', { clientX: t.clientX, clientY: t.clientY, button: 0 })
        canvas3d.dispatchEvent(evt)
      } else if (e.touches.length === 2) {
        // 2 fingers: camera control (zoom/pan)
        const dx = e.touches[0].clientX - e.touches[1].clientX
        const dy = e.touches[0].clientY - e.touches[1].clientY
        touchDistance = Math.hypot(dx, dy)
      }
    }, { passive: false })

    canvas3d.addEventListener('touchmove', (e: TouchEvent) => {
      e.preventDefault()
      if (e.touches.length === 1 && lastTouch) {
        const t = e.touches[0]
        const evt = new PointerEvent('pointermove', { clientX: t.clientX, clientY: t.clientY })
        canvas3d.dispatchEvent(evt)
        lastTouch = { x: t.clientX, y: t.clientY }
      } else if (e.touches.length === 2 && controls) {
        // Pinch zoom
        const dx = e.touches[0].clientX - e.touches[1].clientX
        const dy = e.touches[0].clientY - e.touches[1].clientY
        const newDist = Math.hypot(dx, dy)
        if (touchDistance > 0) {
          const scale = touchDistance / newDist
          controls.object.position.lerp(controls.target, scale * 0.1)
          controls.update()
        }
        touchDistance = newDist
      }
    }, { passive: false })

    canvas3d.addEventListener('touchend', (e: TouchEvent) => {
      e.preventDefault()
      if (e.touches.length === 0) {
        lastTouch = null
        touchDistance = 0
      }
    }, { passive: false })
  }
})

// Rebuild grid when dimensions, currentZ, currentAxis, or mirror settings change
watch(
  () => [
    store.dimW,
    store.dimH,
    store.dimD,
    store.currentZ,
    store.currentAxis,
    store.mirrorX,
    store.mirrorY,
    store.mirrorZ,
    store.mirrorPoint,
    store.mirrorCenterX,
    store.mirrorCenterY,
    store.mirrorCenterZ,
  ],
  () => {
    rebuildGrid()
  },
)

// Rebuild 3D meshes when voxels change (including undo/redo)
watch(() => store.voxels, () => {
  rebuildAllMeshes()
}, { deep: true })

onUnmounted(() => {
  dispose()
})

// ============================================================
// Background setting (called from App via expose)
// ============================================================
function setBackground(bg: { type: string; color1: string; color2: string; imageTexture?: THREE.Texture | null }): void {
  if (!renderer || !scene) return

  if (bg.imageTexture) {
    scene.background = bg.imageTexture
    renderer.setClearColor(0x000000, 0)
    return
  }

  if (bg.type === 'gradient') {
    const canvas = document.createElement('canvas')
    canvas.width = 2
    canvas.height = 512
    const ctx = canvas.getContext('2d')!
    const gradient = ctx.createLinearGradient(0, 0, 0, 512)
    gradient.addColorStop(0, bg.color1)
    gradient.addColorStop(1, bg.color2)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 2, 512)
    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true
    scene.background = texture
    renderer.setClearColor(0x000000, 0)
  } else if (bg.type === 'checker') {
    const size = 32
    const canvas = document.createElement('canvas')
    canvas.width = size * 2
    canvas.height = size * 2
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = bg.color1
    ctx.fillRect(0, 0, size * 2, size * 2)
    ctx.fillStyle = bg.color2
    ctx.fillRect(size, 0, size, size)
    ctx.fillRect(0, size, size, size)
    const texture = new THREE.CanvasTexture(canvas)
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(8, 8)
    scene.background = texture
    renderer.setClearColor(0x000000, 0)
  } else {
    scene.background = new THREE.Color(bg.color1)
    renderer.setClearColor(bg.color1)
  }
}

defineExpose({ dispose, cancelAnchor, setBackground, getRendererDomElement: () => renderer?.domElement ?? null, getVoxelGroup: () => voxelGroup })
</script>