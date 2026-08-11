import * as THREE from 'three'
import { useVoxelStore, type VoxelKey, type Point3D, type VoxelDirection } from '@/stores/voxelStore'

// ============================================================
// Shared hollow-cylinder LatheGeometry (created once, reused by all voxel meshes)
// Profile creates a C-shaped cross-section:
//   outer bottom → outer top → inner top → inner bottom → (close)
// When revolved 360° around Y-axis, this produces a hollow cylinder
// with walls + top/bottom annular caps.
// ============================================================

const PROFILE_POINTS: THREE.Vector2[] = [
  new THREE.Vector2(0.5, 0),     // outer bottom (diameter ~0.94, fits 1x1 cell)
  new THREE.Vector2(0.5, 1),  // outer top
  new THREE.Vector2(0.3, 1),  // inner top (radius ~0.29, inner diameter ~0.58)
  new THREE.Vector2(0.3, 0),     // inner bottom
]

let sharedGeometry: THREE.BufferGeometry | null = null

function getSharedGeometry(): THREE.BufferGeometry {
  if (!sharedGeometry) {
    sharedGeometry = new THREE.LatheGeometry(PROFILE_POINTS, 32)
  }
  return sharedGeometry
}

// ============================================================
// Module-level singleton state (shared across all callers)
// ============================================================

const meshMap = new Map<VoxelKey, THREE.Mesh>()
const voxelGroup = new THREE.Group()
const ghostGroup = new THREE.Group()
let ghostMeshes: THREE.Mesh[] = []
let ghostMaterial: THREE.MeshStandardMaterial | null = null

voxelGroup.name = 'voxelGroup'
ghostGroup.name = 'ghostGroup'

// ============================================================
// Composable
// ============================================================

export function useVoxelGeometry() {
  const store = useVoxelStore()

  // --- Material factory ---
  function createMaterial(color: string, alpha: number): THREE.MeshStandardMaterial {
    const opacity = alpha / 255
    return new THREE.MeshStandardMaterial({
      color,
      transparent: opacity < 1,
      opacity,
      roughness: 0.5,
      metalness: 0.1,
      flatShading: true,
    })
  }

  // ============================================================
  // Direction rotation helpers
  // ============================================================

  /** Get rotation for a given direction. Y is default (no rotation). */
  function getDirectionRotation(direction: VoxelDirection = 'y'): { x: number; y: number; z: number } {
    switch (direction) {
      case 'x': return { x: 0, y: 0, z: -Math.PI / 2 }  // Rotate -90° around Z to point along X
      case 'y': return { x: 0, y: 0, z: 0 }              // Default: no rotation, points along Y
      case 'z': return { x: Math.PI / 2, y: 0, z: 0 }    // Rotate 90° around X to point along Z
    }
  }

  /** Get mesh position for a given direction to keep voxel in cell bounds.
   *  Geometry: cylinder with radius 0.5, height 1, occupies [-0.5,0.5] x [0,1] x [-0.5,0.5]
   *  We want the final voxel to occupy [x, x+1] x [y, y+1] x [z, z+1].
   *  After rotation, we need different mesh.position for each direction.
   */
  function getMeshPosition(x: number, y: number, z: number, direction: VoxelDirection = 'y'): { x: number; y: number; z: number } {
    switch (direction) {
      case 'y': return { x: x + 0.5, y: y, z: z + 0.5 }      // No rotation, offset to center
      case 'x': return { x: x, y: y + 0.5, z: z + 0.5 }      // After -90° Z rotation
      case 'z': return { x: x + 0.5, y: y + 0.5, z: z }      // After 90° X rotation
    }
  }

  // ============================================================
  // addMesh / removeMesh / updateMeshColor
  // ============================================================

  /** Add or update a voxel mesh. Returns the mesh, or null if no change needed. */
  function addMesh(
    x: number,
    y: number,
    z: number,
    color: string,
    alpha = 255,
    direction: VoxelDirection = 'y',
  ): THREE.Mesh {
    const key = store.vk(x, y, z)

    // If mesh already exists, just update material, rotation and position
    const existing = meshMap.get(key)
    if (existing) {
      const mat = existing.material as THREE.MeshStandardMaterial
      const opacity = alpha / 255
      mat.color.set(color)
      mat.opacity = opacity
      mat.transparent = opacity < 1
      // Update rotation and position based on direction
      const rot = getDirectionRotation(direction)
      existing.rotation.set(rot.x, rot.y, rot.z)
      const pos = getMeshPosition(x, y, z, direction)
      existing.position.set(pos.x, pos.y, pos.z)
      return existing
    }

    const geometry = getSharedGeometry()
    const material = createMaterial(color, alpha)
    const mesh = new THREE.Mesh(geometry, material)

    // Position: voxel cell 1×1×1, adjusted for direction
    const rot = getDirectionRotation(direction)
    const pos = getMeshPosition(x, y, z, direction)
    mesh.position.set(pos.x, pos.y, pos.z)
    mesh.rotation.set(rot.x, rot.y, rot.z)
    mesh.userData = { vx: x, vy: y, vz: z, direction }
    voxelGroup.add(mesh)
    meshMap.set(key, mesh)
    return mesh
  }

  /** Remove a voxel mesh and dispose its material. */
  function removeMesh(x: number, y: number, z: number): void {
    const key = store.vk(x, y, z)
    const mesh = meshMap.get(key)
    if (!mesh) return
    voxelGroup.remove(mesh)
      ; (mesh.material as THREE.Material).dispose()
    meshMap.delete(key)
  }

  /** Update color/alpha of an existing mesh without rebuilding. */
  function updateMeshColor(
    x: number,
    y: number,
    z: number,
    color: string,
    alpha = 255,
  ): void {
    const key = store.vk(x, y, z)
    const mesh = meshMap.get(key)
    if (!mesh) return
    const mat = mesh.material as THREE.MeshStandardMaterial
    const opacity = alpha / 255
    mat.color.set(color)
    mat.opacity = opacity
    mat.transparent = opacity < 1
  }

  // ============================================================
  // rebuildAllMeshes — full teardown + rebuild from store
  // ============================================================

  /** Dispose all meshes and rebuild from the current voxel store state. */
  function rebuildAllMeshes(): void {
    // Dispose all existing
    meshMap.forEach((mesh) => {
      voxelGroup.remove(mesh)
        ; (mesh.material as THREE.Material).dispose()
    })
    meshMap.clear()

    // Recreate from store
    store.voxels.forEach((data, key) => {
      const [x, y, z] = store.pv(key)
      addMesh(x, y, z, data.color, data.alpha ?? 255, data.direction ?? 'y')
    })

    // Restore layer visibility
    const zValues = store.getUniqueZValues()
    for (const z of zValues) {
      setLayerMeshVisibility(z, store.isLayerVisible(z))
    }
  }

  // ============================================================
  // Layer visibility
  // ============================================================

  /** Show/hide all meshes on a given Z-layer. */
  function setLayerMeshVisibility(z: number, visible: boolean): void {
    meshMap.forEach((mesh, key) => {
      const [, , mz] = store.pv(key)
      if (mz === z) {
        mesh.visible = visible
      }
    })
  }

  // ============================================================
  // Ghost preview (semi-transparent overlay)
  // ============================================================

  /**
   * Show ghost preview for a set of voxel positions.
   * Draw mode uses the given color; erase mode uses red.
   */
  function showGhost(
    points: Point3D[],
    color: string,
    mode: 'draw' | 'erase' = 'draw',
    direction: VoxelDirection = 'y',
  ): void {
    clearGhost()

    if (points.length === 0) return

    const ghostColor = mode === 'erase' ? '#ff4444' : color
    ghostMaterial = new THREE.MeshStandardMaterial({
      color: ghostColor,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
    })

    const geometry = getSharedGeometry()
    const rot = getDirectionRotation(direction)
    for (const { x, y, z } of points) {
      const mesh = new THREE.Mesh(geometry, ghostMaterial)
      const pos = getMeshPosition(x, y, z, direction)
      mesh.position.set(pos.x, pos.y, pos.z)
      mesh.rotation.set(rot.x, rot.y, rot.z)
      ghostGroup.add(mesh)
      ghostMeshes.push(mesh)
    }
  }

  /** Remove all ghost meshes. */
  function clearGhost(): void {
    for (const mesh of ghostMeshes) {
      ghostGroup.remove(mesh)
    }
    ghostMeshes = []
    if (ghostMaterial) {
      ghostMaterial.dispose()
      ghostMaterial = null
    }
  }

  // ============================================================
  // InstancedMesh fallback stub (T3.6)
  // ============================================================

  /**
   * Check if InstancedMesh optimization is warranted (>10k voxels).
   * Full implementation deferred to T3.6.
   */
  function maybeSwitchToInstanced(): void {
    // Deferred to future optimization (InstancedMesh for >10K voxels)
  }

  // ============================================================
  // Full cleanup
  // ============================================================

  /** Dispose ALL Three.js resources held by this composable. */
  function disposeAll(): void {
    // Dispose individual meshes
    meshMap.forEach((mesh) => {
      voxelGroup.remove(mesh)
        ; (mesh.material as THREE.Material).dispose()
    })
    meshMap.clear()

    // Clear ghost
    clearGhost()

    // Dispose shared geometry
    if (sharedGeometry) {
      sharedGeometry.dispose()
      sharedGeometry = null
    }
  }

  // ============================================================
  // Wireframe toggle
  // ============================================================

  let wireframe = false
  function toggleWireframe(): void {
    wireframe = !wireframe
    meshMap.forEach(mesh => {
      const mat = mesh.material as THREE.MeshStandardMaterial
      mat.wireframe = wireframe
    })
  }

  // ============================================================
  // Return public API
  // ============================================================

  return {
    // Groups (attach to scene)
    voxelGroup,
    ghostGroup,

    // Mesh map (read-only for queries)
    meshMap,

    // Mesh CRUD
    addMesh,
    removeMesh,
    updateMeshColor,

    // Direction helpers
    getDirectionRotation,
    getMeshPosition,

    // Bulk operations
    rebuildAllMeshes,
    setLayerMeshVisibility,

    // Ghost preview
    showGhost,
    clearGhost,

    // Wireframe
    toggleWireframe,

    // Lifecycle
    disposeAll,
    maybeSwitchToInstanced,
  }
}
