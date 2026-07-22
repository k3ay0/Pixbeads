/** 应用模式类型 */
export type AppMode = 'optimize' | 'edit' | 'preview' | 'focus' | 'voxel'

/** 模式配置 */
export const MODES: { key: AppMode; label: string }[] = [
  { key: 'optimize', label: '优化' },
  { key: 'edit', label: '编辑' },
  { key: 'preview', label: '预览' },
  { key: 'focus', label: '专心' },
  { key: 'voxel', label: '3D 编辑' },
]
