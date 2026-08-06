/**
 * 物理交互效果 composable
 *
 * 实现原理:
 * - 磁性按钮: 弹簧吸附 (F = -k*x - c*v)
 * - 涟漪: 扩散+淡出, 模拟水波物理
 * - 3D 倾斜: 鼠标位置映射到 rotateX/rotateY, 弹簧回归
 * - 视差: 不同的 depth 系数产生前后景位移
 * - 珠子浮动: 二阶弹簧阻尼系统模拟真实物理弹跳
 *
 * 性能优化:
 * - 使用 requestAnimationFrame + transform, 避免 layout/paint
 * - 通过 IntersectionObserver 暂停视口外动画
 * - passive event listeners 避免阻塞滚动
 */
import { onMounted, onUnmounted, type Ref } from 'vue'

// ============ 类型定义 ============
interface SpringConfig {
  /** 刚度 k (越大弹性越强) */
  stiffness: number
  /** 阻尼 c (越大振荡衰减越快) */
  damping: number
  /** 质量 m (影响响应延迟) */
  mass: number
  /** 精度阈值, 低于此值视为稳定, 默认 0.001 */
  precision?: number
}

interface MagneticConfig {
  /** 吸附强度 (0-1) */
  strength: number
  /** 吸附半径 (像素), 默认 100 */
  radius?: number
}

interface TiltConfig {
  /** 最大倾斜角度 (度) */
  max: number
  /** 透视距离 (像素), 默认 600 */
  perspective?: number
  /** 悬停时缩放, 默认 1.02 */
  scale?: number
  /** 是否添加高光反射效果, 默认 true */
  glare?: boolean
}

// ============ 弹簧物理引擎 ============

/**
 * 二阶弹簧-阻尼系统
 * 物理方程: m * a = -k * (x - target) - c * v
 * 数值积分: 半隐式 Euler (symplectic), 稳定且高效
 *
 * 特点:
 * - 真实惯性: 速度不会突变, 会"滑过"目标点后回弹
 * - 弹性回弹: 偏离目标后受弹簧力拉回, 产生振荡
 * - 阻尼衰减: 阻尼力使振荡逐渐减小直至静止
 * - 自然手感: 模拟真实物理世界中的弹簧运动
 */
class Spring {
  private position = 0
  private velocity = 0
  private target = 0
  private config: Required<SpringConfig>
  private settled = true

  constructor(config: SpringConfig) {
    this.config = {
      stiffness: config.stiffness ?? 170,
      damping: config.damping ?? 26,
      mass: config.mass ?? 1,
      precision: config.precision ?? 0.001,
    }
  }

  setTarget(value: number) {
    this.target = value
    this.settled = false
  }

  setImmediate(value: number) {
    this.target = value
    this.position = value
    this.velocity = 0
    this.settled = true
  }

  /**
   * 单步物理积分
   * @param dt 时间步长 (秒)
   * @returns 是否已稳定
   */
  step(dt: number): boolean {
    if (this.settled) return true

    const { stiffness: k, damping: c, mass: m, precision } = this.config
    const displacement = this.position - this.target

    // 弹簧力: F_spring = -k * x
    // 阻尼力: F_damping = -c * v
    // 加速度: a = (F_spring + F_damping) / m
    const force = -k * displacement - c * this.velocity
    const acceleration = force / m

    // 半隐式 Euler 积分: 先更新速度, 再用新速度更新位置
    // 比显式 Euler 更稳定, 能量不发散
    this.velocity += acceleration * dt
    this.position += this.velocity * dt

    // 稳定性检测: 位移和速度都极小
    if (Math.abs(displacement) < precision && Math.abs(this.velocity) < precision) {
      this.position = this.target
      this.velocity = 0
      this.settled = true
    }

    return this.settled
  }

  get value() { return this.position }
  get isSettled() { return this.settled }
}

/**
 * 二维弹簧系统 (用于磁性吸附、卡片倾斜)
 * 两个独立的 Spring 分别处理 x 和 y 方向
 */
class Spring2D {
  private springX: Spring
  private springY: Spring

  constructor(config: SpringConfig) {
    this.springX = new Spring(config)
    this.springY = new Spring(config)
  }

  setTarget(x: number, y: number) {
    this.springX.setTarget(x)
    this.springY.setTarget(y)
  }

  setImmediate(x: number, y: number) {
    this.springX.setImmediate(x)
    this.springY.setImmediate(y)
  }

  step(dt: number): boolean {
    const settledX = this.springX.step(dt)
    const settledY = this.springY.step(dt)
    return settledX && settledY
  }

  get x() { return this.springX.value }
  get y() { return this.springY.value }
}

// ============ RAF 循环管理 ============

interface RAFTask {
  id: number
  callback: (dt: number) => void
  active: boolean
}

const rafTasks = new Map<number, RAFTask>()
let rafRunning = false
let lastTime = 0
let nextId = 1

function rafLoop(time: number) {
  if (!rafRunning) return

  // 计算 delta time, 限制最大值避免标签页切换后大跳跃
  const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0.016
  lastTime = time

  for (const task of rafTasks.values()) {
    if (task.active) {
      task.callback(dt)
    }
  }

  requestAnimationFrame(rafLoop)
}

function startRAF() {
  if (!rafRunning) {
    rafRunning = true
    lastTime = 0
    requestAnimationFrame(rafLoop)
  }
}

function registerRAF(callback: (dt: number) => void): () => void {
  const id = nextId++
  const task: RAFTask = { id, callback, active: true }
  rafTasks.set(id, task)
  startRAF()
  return () => {
    rafTasks.delete(id)
    if (rafTasks.size === 0) {
      rafRunning = false
    }
  }
}

// ============ 指令实现 ============

/**
 * 磁性按钮指令: 鼠标接近时, 元素被"吸引"向鼠标方向偏移
 * 离开后弹簧回弹至原位, 带真实惯性
 *
 * 使用:
 *   <button v-magnetic>...</button>
 *   <button v-magnetic="0.4">...</button>  // 自定义强度
 *   <button v-magnetic="{ strength: 0.5, radius: 120 }">...</button>
 */
export const vMagnetic = {
  mounted(el: HTMLElement, binding: { value?: number | MagneticConfig }) {
    const config: MagneticConfig = typeof binding.value === 'number'
      ? { strength: binding.value }
      : { strength: 0.4, ...(binding.value || {}) }

    const radius = config.radius ?? 100
    // 弹簧参数: 中等刚度, 较高阻尼, 避免过度振荡
    const spring = new Spring2D({
      stiffness: 200,
      damping: 20,
      mass: 0.5,
      precision: 0.01,
    })

    let cleanupRAF: (() => void) | null = null

    const handleMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2
      const dx = e.clientX - centerX
      const dy = e.clientY - centerY
      const distance = Math.sqrt(dx * dx + dy * dy)

      if (distance < radius) {
        // 在吸附半径内, 目标位置 = 鼠标偏移 * 强度
        spring.setTarget(dx * config.strength, dy * config.strength)
      } else {
        // 超出半径, 回弹至原位
        spring.setTarget(0, 0)
      }
    }

    const handleLeave = () => {
      spring.setTarget(0, 0)
    }

    // RAF 循环驱动弹簧物理
    cleanupRAF = registerRAF(() => {
      spring.step(0.016)
      el.style.transform = `translate(${spring.x}px, ${spring.y}px)`
    })

    // 监听父级(通常是文档)的鼠标移动, 实现接近即吸附
    document.addEventListener('mousemove', handleMove, { passive: true })
    el.addEventListener('mouseleave', handleLeave)

    // 清理函数存储
    ;(el as any)._magneticCleanup = () => {
      document.removeEventListener('mousemove', handleMove)
      el.removeEventListener('mouseleave', handleLeave)
      cleanupRAF?.()
    }
  },
  unmounted(el: HTMLElement) {
    ;(el as any)._magneticCleanup?.()
  },
}

/**
 * 点击涟漪指令: Material Design 风格的扩散涟漪
 * 扩散+淡出, 模拟水波物理传播
 *
 * 使用:
 *   <button v-ripple>...</button>
 *   <a v-ripple href="...">...</a>
 */
export const vRipple = {
  mounted(el: HTMLElement) {
    el.style.position = el.style.position || 'relative'
    el.style.overflow = 'hidden'

    const handleClick = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect()
      const size = Math.max(rect.width, rect.height) * 1.5
      const x = e.clientX - rect.left - size / 2
      const y = e.clientY - rect.top - size / 2

      // 创建涟漪元素
      const ripple = document.createElement('span')
      ripple.style.cssText = `
        position: absolute;
        left: ${x}px;
        top: ${y}px;
        width: ${size}px;
        height: ${size}px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0) 70%);
        pointer-events: none;
        transform: scale(0);
        opacity: 1;
        animation: pixbeads-ripple 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
      `
      el.appendChild(ripple)

      // 动画结束后移除
      ripple.addEventListener('animationend', () => ripple.remove(), { once: true })
    }

    el.addEventListener('click', handleClick)
    ;(el as any)._rippleCleanup = () => {
      el.removeEventListener('click', handleClick)
    }
  },
  unmounted(el: HTMLElement) {
    ;(el as any)._rippleCleanup?.()
  },
}

/**
 * 3D 倾斜指令: 鼠标悬停时元素跟随鼠标方向倾斜
 * 离开后弹簧回正, 带惯性
 *
 * 使用:
 *   <div v-tilt>...</div>
 *   <div v-tilt="{ max: 15, scale: 1.05 }">...</div>
 */
export const vTilt = {
  mounted(el: HTMLElement, binding: { value?: Partial<TiltConfig> }) {
    const config: Required<TiltConfig> = {
      max: binding.value?.max ?? 12,
      perspective: binding.value?.perspective ?? 600,
      scale: binding.value?.scale ?? 1.02,
      glare: binding.value?.glare ?? true,
    }

    // 两个弹簧分别处理 rotateX 和 rotateY
    const springX = new Spring({ stiffness: 150, damping: 18, mass: 0.4, precision: 0.05 })
    const springY = new Spring({ stiffness: 150, damping: 18, mass: 0.4, precision: 0.05 })

    let cleanupRAF: (() => void) | null = null
    let isHovering = false
    let glareEl: HTMLElement | null = null

    // 添加高光反射层 (模拟光线随视角变化)
    if (config.glare) {
      glareEl = document.createElement('div')
      glareEl.style.cssText = `
        position: absolute;
        inset: 0;
        pointer-events: none;
        background: radial-gradient(
          circle at var(--glare-x, 50%) var(--glare-y, 50%),
          rgba(255, 255, 255, 0.25) 0%,
          rgba(255, 255, 255, 0) 50%
        );
        opacity: 0;
        transition: opacity 0.3s ease;
        border-radius: inherit;
      `
      el.appendChild(glareEl)
    }

    const handleEnter = () => {
      isHovering = true
      if (glareEl) glareEl.style.opacity = '1'
    }

    const handleMove = (e: MouseEvent) => {
      if (!isHovering) return

      const rect = el.getBoundingClientRect()
      const x = (e.clientX - rect.left) / rect.width   // 0-1
      const y = (e.clientY - rect.top) / rect.height    // 0-1

      // 映射到倾斜角度: 鼠标在右侧 -> 向右倾斜 (rotateY 正)
      // 鼠标在下方 -> 向下倾斜 (rotateX 负, 因为 rotateX 正是向后)
      const rotateY = (x - 0.5) * 2 * config.max
      const rotateX = -(y - 0.5) * 2 * config.max

      springY.setTarget(rotateY)
      springX.setTarget(rotateX)

      // 更新高光位置
      if (glareEl) {
        glareEl.style.setProperty('--glare-x', `${x * 100}%`)
        glareEl.style.setProperty('--glare-y', `${y * 100}%`)
      }
    }

    const handleLeave = () => {
      isHovering = false
      springX.setTarget(0)
      springY.setTarget(0)
      if (glareEl) glareEl.style.opacity = '0'
    }

    // 设置 transform-style 以支持 3D
    el.style.transformStyle = 'preserve-3d'
    el.style.willChange = 'transform'
    el.style.transition = 'transform 0.1s ease-out'

    // RAF 驱动物理
    cleanupRAF = registerRAF(() => {
      springX.step(0.016)
      springY.step(0.016)

      const scale = isHovering ? config.scale : 1
      el.style.transform = `
        perspective(${config.perspective}px)
        rotateX(${springX.value}deg)
        rotateY(${springY.value}deg)
        scale(${scale})
      `
    })

    el.addEventListener('mouseenter', handleEnter)
    el.addEventListener('mousemove', handleMove)
    el.addEventListener('mouseleave', handleLeave)

    ;(el as any)._tiltCleanup = () => {
      el.removeEventListener('mouseenter', handleEnter)
      el.removeEventListener('mousemove', handleMove)
      el.removeEventListener('mouseleave', handleLeave)
      cleanupRAF?.()
      glareEl?.remove()
    }
  },
  unmounted(el: HTMLElement) {
    ;(el as any)._tiltCleanup?.()
  },
}

// ============ 组合式函数 ============

/**
 * 鼠标视差: 全局鼠标位置驱动多个元素的差速位移
 * 元素离视点越"远"(depth 小), 位移越大
 *
 * 使用:
 *   const { parallaxStyle } = useParallax()
 *   // 在模板中:
 *   <div :style="parallaxStyle(0.3)">...</div>  // depth 0.3, 移动 30%
 */
export function useParallax() {
  const mouseX = { current: 0, target: 0 }
  const mouseY = { current: 0, target: 0 }
  let cleanupRAF: (() => void) | null = null

  // 弹簧平滑鼠标移动, 避免抖动
  const springX = new Spring({ stiffness: 120, damping: 20, mass: 1, precision: 0.001 })
  const springY = new Spring({ stiffness: 120, damping: 20, mass: 1, precision: 0.001 })

  const handleMove = (e: MouseEvent) => {
    // 归一化到 -1 ~ 1 (屏幕中心为 0)
    mouseX.target = (e.clientX / window.innerWidth - 0.5) * 2
    mouseY.target = (e.clientY / window.innerHeight - 0.5) * 2
  }

  onMounted(() => {
    window.addEventListener('mousemove', handleMove, { passive: true })

    cleanupRAF = registerRAF(() => {
      springX.setTarget(mouseX.target)
      springY.setTarget(mouseY.target)
      springX.step(0.016)
      springY.step(0.016)
      mouseX.current = springX.value
      mouseY.current = springY.value
    })
  })

  onUnmounted(() => {
    window.removeEventListener('mousemove', handleMove)
    cleanupRAF?.()
  })

  /**
   * 生成视差样式
   * @param depth 深度系数 (0-1), 越大移动越少
   * @param maxOffset 最大位移 (像素), 默认 30
   */
  const parallaxStyle = (depth: number, maxOffset = 30) => {
    const factor = (1 - depth) * maxOffset
    return {
      transform: `translate(${mouseX.current * factor}px, ${mouseY.current * factor}px)`,
    }
  }

  return { parallaxStyle, mouseX, mouseY }
}

/**
 * 珠子物理浮动: 模拟一组珠子在流体中浮动的效果
 * 每颗珠子有独立的相位和振幅, 通过 sin 函数组合产生自然浮动
 *
 * 物理模型:
 * - y 方向: 多频率 sin 叠加, 模拟水面波浪
 * - x 方向: 缓慢的 sin 摆动
 * - 鼠标交互: 鼠标接近时珠子被"推开" (反向弹簧)
 *
 * 使用:
 *   const { beadStyle } = useFloatingBeads(count)
 *   // 在模板中:
 *   <div v-for="i in count" :key="i" :style="beadStyle(i - 1, containerEl)" />
 */
export function useFloatingBeads(
  count: number,
  options: { getContainer?: () => HTMLElement | null } = {}
) {
  const getContainer = options.getContainer

  interface BeadState {
    phaseX: number
    phaseY: number
    freqX: number
    freqY: number
    ampX: number
    ampY: number
    // 随机漂移状态
    driftX: number
    driftY: number
    driftVX: number
    driftVY: number
    nextChange: number
  }

  const DRIFT_SPEED = 10 // 漂移速度 (像素/秒)

  /**
   * 动态漂移边界: 若提供容器, 边界 = 容器尺寸的一半 (在整个区域内游走),
   * 否则退回 ±24px
   */
  function getBounds() {
    if (getContainer) {
      const c = getContainer()
      if (c) {
        return { x: Math.max(c.clientWidth / 2, 1), y: Math.max(c.clientHeight / 2, 1) }
      }
    }
    return { x: 24, y: 24 }
  }

  function randomizeDirection(b: BeadState) {
    const angle = Math.random() * Math.PI * 2
    const magnitude = DRIFT_SPEED * (0.4 + Math.random() * 0.6)
    b.driftVX = Math.cos(angle) * magnitude
    b.driftVY = Math.sin(angle) * magnitude
    b.nextChange = 1.5 + Math.random() * 3.5
  }

  const beads: BeadState[] = []
  const els: (HTMLElement | null)[] = []
  for (let i = 0; i < count; i++) {
    const bead: BeadState = {
      phaseX: Math.random() * Math.PI * 2,
      phaseY: Math.random() * Math.PI * 2,
      freqX: 0.3 + Math.random() * 0.4,
      freqY: 0.5 + Math.random() * 0.6,
      ampX: 3 + Math.random() * 4,
      ampY: 5 + Math.random() * 6,
      driftX: 0,
      driftY: 0,
      driftVX: 0,
      driftVY: 0,
      nextChange: 0,
    }
    randomizeDirection(bead)
    beads.push(bead)
    els.push(null)
  }

  /** 模板 :ref 收集元素 */
  const setBeadEl = (index: number, el: any) => {
    if (el instanceof HTMLElement) {
      els[index] = el
    }
  }

  let time = 0
  let last = 0
  let mouseGlobalX = 0
  let mouseGlobalY = 0
  let cleanupRAF: (() => void) | null = null

  const handleMove = (e: MouseEvent) => {
    mouseGlobalX = e.clientX
    mouseGlobalY = e.clientY
  }

  onMounted(() => {
    window.addEventListener('mousemove', handleMove, { passive: true })
    last = performance.now()

    cleanupRAF = registerRAF(() => {
      const now = performance.now()
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      time += dt

      // 每帧读取动态边界 (跟随容器尺寸, 覆盖整个区域)
      const bounds = getBounds()

      // 更新每颗珠子的随机漂移 + 写 DOM
      for (let i = 0; i < beads.length; i++) {
        const b = beads[i]
        const el = els[i]
        if (!el) continue

        b.nextChange -= dt
        if (b.nextChange <= 0) randomizeDirection(b)

        b.driftX += b.driftVX * dt
        b.driftY += b.driftVY * dt

        // 边界反弹
        if (b.driftX > bounds.x || b.driftX < -bounds.x) {
          b.driftVX *= -1
          b.driftX = Math.max(-bounds.x, Math.min(bounds.x, b.driftX))
        }
        if (b.driftY > bounds.y || b.driftY < -bounds.y) {
          b.driftVY *= -1
          b.driftY = Math.max(-bounds.y, Math.min(bounds.y, b.driftY))
        }

        // 基础浮动: sin 波叠加 + 随机漂移
        const baseX = Math.sin(time * b.freqX + b.phaseX) * b.ampX + b.driftX
        const baseY = Math.sin(time * b.freqY + b.phaseY) * b.ampY + b.driftY

        // 鼠标推开: 用珠子当前屏幕位置计算反向推力
        let pushX = 0
        let pushY = 0
        const rect = el.getBoundingClientRect()
        const beadScreenX = rect.left + rect.width / 2
        const beadScreenY = rect.top + rect.height / 2
        const dx = beadScreenX - mouseGlobalX
        const dy = beadScreenY - mouseGlobalY
        const dist = Math.sqrt(dx * dx + dy * dy)
        const pushRadius = 120
        if (dist < pushRadius && dist > 0) {
          const force = (1 - dist / pushRadius) * 40
          pushX = (dx / dist) * force
          pushY = (dy / dist) * force
        }

        // 直接写 DOM, 实时移动
        el.style.transform = `translate(${baseX + pushX}px, ${baseY + pushY}px)`
      }
    })
  })

  onUnmounted(() => {
    window.removeEventListener('mousemove', handleMove)
    cleanupRAF?.()
  })

  return { setBeadEl }
}

/**
 * 滚动揭示: 元素进入视口时触发动画
 * 基于 IntersectionObserver, 性能优于 scroll 监听
 *
 * 使用:
 *   const { revealRef } = useScrollReveal()
 *   // 在模板中:
 *   <div ref="revealRef" class="reveal-item">...</div>
 *
 *   // 自定义选项:
 *   <div ref="el => revealRef(el, { threshold: 0.3 })">...</div>
 */
export function useScrollReveal() {
  const observers: IntersectionObserver[] = []

  /**
   * 注册元素为揭示目标
   * @param el 目标元素
   * @param options IntersectionObserver 选项
   */
  const revealRef = (
    el: any,
    options: { threshold?: number; rootMargin?: string; once?: boolean } = {}
  ) => {
    // Vue 模板内联 ref 会传入 Element 或组件实例, 运行时窄化为 HTMLElement
    if (!(el instanceof HTMLElement)) return

    // 初始状态: 透明 (transform 不在这里设, 完全交给 v-tilt/物理指令管理)
    el.style.opacity = '0'
    el.style.transition = 'opacity 0.7s cubic-bezier(0.16, 1, 0.3, 1)'
    el.style.willChange = 'opacity'

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            // 进入视口: 淡入 (不动 transform, 避免与 v-tilt 抢)
            const target = entry.target as HTMLElement
            target.style.opacity = '1'

            if (options.once !== false) {
              observer.unobserve(target)
            }
          } else if (options.once === false) {
            // 离开视口: 重置透明度 (仅当 once: false 时)
            const target = entry.target as HTMLElement
            target.style.opacity = '0'
          }
        })
      },
      {
        threshold: options.threshold ?? 0.15,
        rootMargin: options.rootMargin ?? '0px 0px -50px 0px',
      }
    )

    observer.observe(el)
    observers.push(observer)
  }

  onUnmounted(() => {
    observers.forEach((o) => o.disconnect())
  })

  return { revealRef }
}

/**
 * 滚动视差: 元素随滚动产生位移, 带惯性平滑
 * 用于背景装饰元素
 *
 * 使用:
 *   const { scrollParallaxStyle } = useScrollParallax()
 *   <div :style="scrollParallaxStyle(0.3)">...</div>
 */
export function useScrollParallax() {
  const scrollY = { current: 0, target: 0 }
  let cleanupRAF: (() => void) | null = null

  // 弹簧平滑滚动, 产生惯性"滑过"效果
  const spring = new Spring({ stiffness: 100, damping: 25, mass: 1, precision: 0.1 })

  const handleScroll = () => {
    scrollY.target = window.scrollY
  }

  onMounted(() => {
    window.addEventListener('scroll', handleScroll, { passive: true })
    scrollY.target = window.scrollY
    scrollY.current = window.scrollY

    cleanupRAF = registerRAF(() => {
      spring.setTarget(scrollY.target)
      spring.step(0.016)
      scrollY.current = spring.value
    })
  })

  onUnmounted(() => {
    window.removeEventListener('scroll', handleScroll)
    cleanupRAF?.()
  })

  /**
   * 生成滚动视差样式
   * @param speed 视差速度 (-1 ~ 1), 正值同向, 负值反向
   * @param maxOffset 最大位移 (像素), 默认 100
   */
  const scrollParallaxStyle = (speed: number, maxOffset = 100) => {
    const offset = Math.max(-maxOffset, Math.min(maxOffset, scrollY.current * speed))
    return { transform: `translateY(${offset}px)` }
  }

  return { scrollParallaxStyle, scrollY }
}

/**
 * 随机漂移: 装饰圆点/元素在页面上缓慢随机游走
 *
 * 物理模型:
 * - 每个点有独立的随机速度向量 (vx, vy)
 * - 每隔随机间隔换向 (随机改变速度方向与大小)
 * - 位置在 [-maxOffset, +maxOffset] 范围内随机游走
 * - RAF 循环中直接写 el.style.transform, 不依赖 Vue 响应式
 *
 * 使用:
 *   const { setDriftEl } = useRandomDrift(3, { maxOffset: 50 })
 *   // 在模板中:
 *   <div :ref="el => setDriftEl(0, el)">...</div>
 */
export function useRandomDrift(
  count: number,
  options: { maxOffset?: number; speed?: number; getContainer?: () => HTMLElement | null } = {}
) {
  const maxOffset = options.maxOffset ?? 40
  const speed = options.speed ?? 20 // 像素/秒
  const getContainer = options.getContainer

  /**
   * 动态漂移边界: 若提供容器, 边界 = 容器尺寸的一半 (在整个区域内游走),
   * 否则退回静态 maxOffset
   */
  function getBounds() {
    if (getContainer) {
      const c = getContainer()
      if (c) {
        return { x: Math.max(c.clientWidth / 2, 1), y: Math.max(c.clientHeight / 2, 1) }
      }
    }
    return { x: maxOffset, y: maxOffset }
  }

  interface DriftState {
    x: number
    y: number
    vx: number
    vy: number
    /** 距下次换向的时间 (秒) */
    nextChange: number
  }

  const states: DriftState[] = []
  const els: (HTMLElement | null)[] = []
  for (let i = 0; i < count; i++) {
    states.push({
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      nextChange: 0,
    })
    els.push(null)
    // 初始化随机速度与换向时间
    randomizeDirection(states[i], true)
  }

  function randomizeDirection(state: DriftState, immediate = false) {
    const angle = Math.random() * Math.PI * 2
    const magnitude = speed * (0.4 + Math.random() * 0.6)
    state.vx = Math.cos(angle) * magnitude
    state.vy = Math.sin(angle) * magnitude
    state.nextChange = immediate ? Math.random() * 2 : 1.5 + Math.random() * 3.5
  }

  /** 模板 :ref 收集元素 */
  const setDriftEl = (index: number, el: any) => {
    if (el instanceof HTMLElement) {
      els[index] = el
    }
  }

  let last = 0
  let cleanupRAF: (() => void) | null = null

  onMounted(() => {
    last = performance.now()

    cleanupRAF = registerRAF(() => {
      const now = performance.now()
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now

      // 每帧读取动态边界 (跟随容器尺寸, 覆盖整个区域)
      const bounds = getBounds()

      for (let i = 0; i < states.length; i++) {
        const s = states[i]
        // 换向计时
        s.nextChange -= dt
        if (s.nextChange <= 0) {
          randomizeDirection(s)
        }

        // 更新位置
        s.x += s.vx * dt
        s.y += s.vy * dt

        // 边界反弹: 超出范围后反转速度并拉回
        if (s.x > bounds.x || s.x < -bounds.x) {
          s.vx *= -1
          s.x = Math.max(-bounds.x, Math.min(bounds.x, s.x))
          randomizeDirection(s)
        }
        if (s.y > bounds.y || s.y < -bounds.y) {
          s.vy *= -1
          s.y = Math.max(-bounds.y, Math.min(bounds.y, s.y))
          randomizeDirection(s)
        }

        // 直接写 DOM, 实时移动
        const el = els[i]
        if (el) {
          el.style.transform = `translate3d(${s.x}px, ${s.y}px, 0)`
        }
      }
    })
  })

  onUnmounted(() => {
    cleanupRAF?.()
  })

  return { setDriftEl }
}

// 显式引用 Ref 以避免 unused 警告 (类型在 useFloatingBeads 中曾使用)
export type { Ref }
