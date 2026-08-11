import * as THREE from 'three'
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'

function downloadBlob(content: string | ArrayBuffer, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function useVoxelExport() {
  function exportOBJ(group: THREE.Group, filename = 'voxel-model'): void {
    const exporter = new OBJExporter()
    const result = exporter.parse(group)
    downloadBlob(result, `${filename}.obj`, 'text/plain')
  }

  function exportSTL(group: THREE.Group, filename = 'voxel-model'): void {
    const exporter = new STLExporter()
    // ASCII format for compatibility
    const result = exporter.parse(group, { binary: false })
    downloadBlob(result, `${filename}.stl`, 'text/plain')
  }

  function exportGLB(group: THREE.Group, filename = 'voxel-model'): void {
    const exporter = new GLTFExporter()
    exporter.parse(
      group,
      (gltf: ArrayBuffer | { [key: string]: unknown }) => {
        downloadBlob(gltf as ArrayBuffer, `${filename}.glb`, 'model/gltf-binary')
      },
      (error: unknown) => {
        console.error('[VoxelExport] GLB export error:', error)
      },
      { binary: true }
    )
  }

  function exportPNG(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, filename = 'voxel-model'): void {
    renderer.render(scene, camera)
    const canvas = renderer.domElement
    const link = document.createElement('a')
    link.download = `${filename}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  function exportVideo(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    duration: number = 3,
    fps: number = 30,
    filename = 'voxel-animation'
  ): void {
    const canvas = renderer.domElement
    const stream = canvas.captureStream(fps)

    // Try WebM first, fallback to mp4
    let mimeType = 'video/webm;codecs=vp9'
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm;codecs=vp8'
    }
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm'
    }

    const recorder = new MediaRecorder(stream, { mimeType })
    const chunks: Blob[] = []

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }

    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${filename}.webm`
      a.click()
      URL.revokeObjectURL(url)
    }

    recorder.start()

    // Render frames
    const totalFrames = duration * fps
    let frame = 0

    function renderFrame() {
      if (frame >= totalFrames) {
        recorder.stop()
        return
      }
      renderer.render(scene, camera)
      frame++
      setTimeout(renderFrame, 1000 / fps)
    }

    renderFrame()
  }

  return { exportOBJ, exportSTL, exportGLB, exportPNG, exportVideo }
}
