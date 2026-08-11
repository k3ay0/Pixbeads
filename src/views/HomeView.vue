<script setup lang="ts">
// Pixbeads 项目首页 — 像素拼豆美学 (浅色, 匹配编辑器风格)
import {
  vRipple,
  vTilt,
  useScrollReveal,
  useRandomDrift,
} from '../composables/usePhysicsInteractions'

// ===== 揭示与随机漂移 =====
const { revealRef } = useScrollReveal()

// 页面容器引用 (装饰圆漂移边界 = 整个页面)
let pageEl: HTMLElement | null = null
const setPageEl = (el: any) => {
  if (el instanceof HTMLElement) pageEl = el
}

// 装饰圆随机漂移 (3 个背景装饰圆, 全页游走)
const { setDriftEl } = useRandomDrift(3, {
  maxOffset: 60,
  speed: 10,
  getContainer: () => pageEl,
})

// ===== 内容数据 =====
const features = [
  { icon: '🖼️', title: '图片上传', desc: '支持拖放或点击选择 JPG / PNG 图片,一键生成拼豆图纸。' },
  { icon: '🧩', title: '智能像素化', desc: '可调粒度(10-200),支持卡通(主色)与真实(均色)两种映射模式。' },
  { icon: '🎨', title: 'Oklab 色彩匹配', desc: '基于感知均匀色彩空间做最近色匹配,比 RGB 欧氏距离更接近人眼观感。' },
  { icon: '🔗', title: 'BFS 区域合并', desc: '自动合并相邻相似颜色,减少杂色、平滑色块,让图纸更干净。' },
  { icon: '✂️', title: '背景移除', desc: '从边界洪水填充,自动识别并移除背景区域。' },
  { icon: '🔍', title: 'OCR 图纸识别', desc: '本地微量 OCR 模型识别图纸色号,识别更准确,数据不出本机。' },
  { icon: '📦', title: '多色号体系', desc: '内置 MARD、COCO、漫漫、盼盼、咪小窝 5 种店家色号,共 291 种标准色。' },
  { icon: '✏️', title: '编辑工具', desc: '画笔、吸管、橡皮擦、区域擦除、颜色替换,支持 50 步撤销/重做。' },
  { icon: '🎯', title: '专心拼豆模式', desc: '灰度背景高亮当前颜色,3 种引导模式与分区网格线,沉浸式制作。' },
  { icon: '💾', title: '多样导出', desc: '带色号 Key 的 PNG 图纸、颜色统计图,以及可再次编辑的 pbds 工程文件。' },
  { icon: '🧱', title: '3D 体素编辑', desc: '二维图纸一键转 3D 体素,支持分层切片与体素级编辑。' },
  { icon: '📱', title: 'PWA 支持', desc: '可安装为桌面应用,离线也能用,所有计算均在本地完成。' },
]

const steps = [
  { num: '01', title: '导入图片', desc: '拖入或选择一张图片,设置画布尺寸与像素化粒度。' },
  { num: '02', title: '调整配色', desc: '切换色号体系、排除不用的颜色,让图纸更贴合手头珠料。' },
  { num: '03', title: '编辑修改', desc: '用画笔、吸管、区域擦除等工具手工微调每一颗珠子。' },
  { num: '04', title: '导出图纸', desc: '下载带 Key 的 PNG 图纸、颜色统计图,或保存 pbds 工程继续修改。' },
]

const techPoints = [
  { title: 'Oklab 感知色彩', desc: '在感知均匀色彩空间中计算色差,匹配结果更符合人眼判断。' },
  { title: 'BFS 连通域合并', desc: '广度优先遍历网格,合并相似色连通区域,去除颗粒噪点。' },
  { title: '洪水填充背景移除', desc: '从图像边界出发识别背景连通域,一键去除杂乱底色。' },
  { title: '本地隐私计算', desc: '像素化、OCR 识别等全部在浏览器本地完成,无需联网上传图片。' },
]

// 滚动揭示交错延迟
function staggeredDelay(i: number) {
  return { transitionDelay: `${i * 60}ms` }
}

// 卡片点击 "+1" 飘字 (拼豆趣味反馈)
function onCardClick(e: MouseEvent) {
  const card = e.currentTarget as HTMLElement
  const plus = document.createElement('span')
  plus.className = 'plus-float'
  const rect = card.getBoundingClientRect()
  plus.style.left = `${e.clientX - rect.left - 18}px`
  plus.style.top = `${e.clientY - rect.top - 10}px`
  card.appendChild(plus)
  setTimeout(() => plus.remove(), 1100)
}
</script>

<template>
  <div class="pixel-page">
    <!-- 背景装饰圆 (全页随机漂移) -->
    <div class="pointer-events-none fixed inset-0 overflow-hidden z-0" aria-hidden="true">
      <div :ref="el => setDriftEl(0, el)" class="pixel-orb orb-1 pixbeads-breathe"></div>
      <div :ref="el => setDriftEl(1, el)" class="pixel-orb orb-2 pixbeads-breathe-slow"></div>
      <div :ref="el => setDriftEl(2, el)" class="pixel-orb orb-3 pixbeads-breathe-slower"></div>
    </div>

    <div :ref="setPageEl" class="pixel-container">
      <!-- ===== 导航栏 ===== -->
      <nav class="navbar">
        <router-link to="/" class="logo">
          <span class="logo-icon">🧶</span>
          <span class="logo-text">PIXBEADS</span>
        </router-link>
        <div class="nav-links">
          <a href="#features">功能特性</a>
          <a href="#workflow">使用流程</a>
          <a href="#tech">技术特色</a>
          <router-link to="/editor" class="btn-pixel " v-ripple>✨ 开始拼豆</router-link>
        </div>
      </nav>

      <!-- ===== HERO ===== -->
      <section class="hero">
        <div class="hero-badge">
          <span class="dot"></span>
          <span>🔥 免费 · 本地运行 · 隐私安全</span>
        </div>
        <h1>
          把任意图片
          <br />
          拼成 <span class="highlight">像素图纸</span>
        </h1>
        <p>
          从一张照片到一颗颗拼豆,一键生成标准拼豆图纸,<br />
          或对已有图纸重新编辑。所有计算均在本地完成。
        </p>
        <div class="hero-actions">
          <router-link to="/editor" class="btn-pixel btn-lg" v-ripple>🚀 进入编辑器</router-link>
          <a href="#features" class="btn-outline-pixel" v-ripple>🎨 了解功能</a>
        </div>
      </section>

      <!-- ===== 功能特性 ===== -->
      <section id="features" class="section">
        <div class="section-title">
          🧩 核心功能 <span>— 从导入到导出,一站式搞定</span>
        </div>
        <div class="gallery">
          <div v-for="(f, i) in features" :key="f.title" :ref="el => revealRef(el, { threshold: 0.15 })"
            v-tilt="{ max: 8, scale: 1.04 }" class="pixel-card" :style="staggeredDelay(i)" @click="onCardClick">
            <span class="emoji-big">{{ f.icon }}</span>
            <h4>{{ f.title }}</h4>
            <p>{{ f.desc }}</p>
            <div class="pixel-dots">
              <span></span><span></span><span></span><span></span><span></span>
            </div>
          </div>
        </div>
      </section>

      <!-- ===== 使用流程 ===== -->
      <section id="workflow" class="section">
        <div class="section-title">
          🛠️ 四步生成 <span>— 简单直观,零基础快速上手</span>
        </div>
        <div class="gallery steps-grid">
          <div v-for="(s, i) in steps" :key="s.num" :ref="el => revealRef(el, { threshold: 0.2 })"
            v-tilt="{ max: 10, scale: 1.05 }" class="pixel-card step-card" :style="staggeredDelay(i)">
            <span class="step-num">{{ s.num }}</span>
            <h4>{{ s.title }}</h4>
            <p>{{ s.desc }}</p>
          </div>
        </div>
      </section>

      <!-- ===== 技术特色 ===== -->
      <section id="tech" class="section">
        <div class="section-title">
          ⚙️ 技术特色 <span>— 严谨算法,只为更准的图纸</span>
        </div>
        <div class="gallery">
          <div v-for="(t, i) in techPoints" :key="t.title" :ref="el => revealRef(el, { threshold: 0.2 })"
            v-tilt="{ max: 6, scale: 1.03 }" class="pixel-card tech-card" :style="staggeredDelay(i)">
            <h4>{{ t.title }}</h4>
            <p>{{ t.desc }}</p>
          </div>
        </div>
      </section>

      <!-- ===== 底部 CTA + 页脚 ===== -->
      <footer class="footer">
        <div class="cta-block">
          <h2 :ref="el => revealRef(el)">准备好开始拼豆了吗?</h2>
          <router-link to="/editor" class="btn-pixel btn-lg" v-ripple>🎮 开始制作第一张图纸</router-link>
        </div>
        <div class="footer-row">
          <span>© 2026 Pixbeads · 拼豆图纸生成器</span>
          <div class="social">
            <a href="https://github.com/k3ay0/Pixbeads" target="_blank" rel="noopener noreferrer"
              aria-label="GitHub"><svg aria-hidden="true" data-component="Octicon" height="24" viewBox="0 0 24 24"
                version="1.1" width="24" data-view-component="true" class="octicon octicon-mark-github">
                <path
                  d="M10.226 17.284c-2.965-.36-5.054-2.493-5.054-5.256 0-1.123.404-2.336 1.078-3.144-.292-.741-.247-2.314.09-2.965.898-.112 2.111.36 2.83 1.01.853-.269 1.752-.404 2.853-.404 1.1 0 1.999.135 2.807.382.696-.629 1.932-1.1 2.83-.988.315.606.36 2.179.067 2.942.72.854 1.101 2 1.101 3.167 0 2.763-2.089 4.852-5.098 5.234.763.494 1.28 1.572 1.28 2.807v2.336c0 .674.561 1.056 1.235.786 4.066-1.55 7.255-5.615 7.255-10.646C23.5 6.188 18.334 1 11.978 1 5.62 1 .5 6.188.5 12.545c0 4.986 3.167 9.12 7.435 10.669.606.225 1.19-.18 1.19-.786V20.63a2.9 2.9 0 0 1-1.078.224c-1.483 0-2.359-.808-2.987-2.313-.247-.607-.517-.966-1.034-1.033-.27-.023-.359-.135-.359-.27 0-.27.45-.471.898-.471.652 0 1.213.404 1.797 1.235.45.651.921.943 1.483.943.561 0 .92-.202 1.437-.719.382-.381.674-.718.944-.943">
                </path>
              </svg>
              <span>Github</span>
            </a>
          </div>
        </div>
      </footer>
    </div>
  </div>
</template>

<style>
@keyframes pixbeads-gradient-flow {
  0% {
    background-position: 0% 50%;
  }

  50% {
    background-position: 100% 50%;
  }

  100% {
    background-position: 0% 50%;
  }
}

.pixel-page {
  min-height: 100vh;
  font-family: 'Inter', 'PingFang SC', 'Segoe UI', system-ui, sans-serif;
  color: #000;
  background: linear-gradient(135deg, #ffffff 0%, #f4f7fb 50%, #eef2f8 100%);
  background-size: 400% 400%;
  animation: pixbeads-gradient-flow 18s ease-in-out infinite alternate;
  padding: 20px;
  display: flex;
  justify-content: center;
  align-items: flex-start;
}

/* ---- 主容器 (玻璃拟态, 浅色) ---- */
.pixel-container {
  position: relative;
  z-index: 1;
  max-width: 1200px;
  width: 100%;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-radius: 48px;
  padding: 40px 48px 56px;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.8);
  border: 1px solid rgba(0, 0, 0, 0.08);
  transition: box-shadow 0.3s ease;
}

.pixel-container:hover {
  box-shadow: 0 30px 60px -12px rgba(0, 0, 0, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.9);
}

/* ---- 背景装饰圆 (全页漂移, 浅色) ---- */
.pixel-orb {
  position: absolute;
  border-radius: 50%;
  background: rgba(0, 123, 229, 0.05);
  border: 1px solid rgba(0, 123, 229, 0.08);
  will-change: transform;
}

.orb-1 {
  width: 260px;
  height: 260px;
  top: 8%;
  left: -80px;
}

.orb-2 {
  width: 180px;
  height: 180px;
  top: 45%;
  right: -60px;
}

.orb-3 {
  width: 220px;
  height: 220px;
  bottom: 5%;
  left: 18%;
}

/* ---- 导航栏 ---- */
.navbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 52px;
  flex-wrap: wrap;
  gap: 16px;
}

.logo {
  display: flex;
  align-items: center;
  gap: 14px;
  text-decoration: none;
}

.logo-icon {
  font-size: 36px;
  line-height: 1;
  filter: drop-shadow(0 0 8px rgba(0, 123, 229, 0.15));
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  display: inline-block;
}

.logo:hover .logo-icon {
  transform: scale(1.15) rotate(-6deg);
}

.logo-text {
  font-family: 'Press Start 2P', monospace;
  font-size: 18px;
  color: #000;
  letter-spacing: 2px;
}

.nav-links {
  display: flex;
  gap: 24px;
  align-items: center;
  flex-wrap: wrap;
}

.nav-links>a:not(.btn-pixel) {
  color: rgba(0, 0, 0, 0.55);
  text-decoration: none;
  font-size: 15px;
  font-weight: 500;
  padding: 6px 0;
  position: relative;
  transition: color 0.25s ease;
  cursor: pointer;
}

.nav-links>a:not(.btn-pixel)::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 50%;
  width: 0;
  height: 2.5px;
  background: #007be5;
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  transform: translateX(-50%);
  border-radius: 4px;
}

.nav-links>a:not(.btn-pixel):hover {
  color: #000;
}

.nav-links>a:not(.btn-pixel):hover::after {
  width: 100%;
}

.nav-links>a:not(.btn-pixel):active {
  transform: scale(0.94);
}

/* ---- 像素按钮 (黑底白字, 匹配编辑器主按钮) ---- */
.btn-pixel {
  font-family: 'Press Start 2P', monospace;
  font-size: 12px;
  background: #000;
  color: #fff;
  border: none;
  padding: 12px 24px;
  border-radius: 40px;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
  box-shadow: 0 4px 0 rgba(0, 0, 0, 0.25);
  letter-spacing: 0.5px;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  will-change: transform;
}

.btn-pixel:hover {
  transform: translateY(-3px) scale(1.02);
  box-shadow: 0 8px 0 rgba(0, 0, 0, 0.2);
  background: rgba(0, 0, 0, 0.8);
}

.btn-pixel:active {
  transform: translateY(4px) scale(0.96);
  box-shadow: 0 2px 0 rgba(0, 0, 0, 0.25);
}

.btn-lg {
  padding: 16px 32px;
  font-size: 14px;
}

.btn-outline-pixel {
  font-family: 'Press Start 2P', monospace;
  font-size: 11px;
  background: transparent;
  color: #000;
  border: 2px solid rgba(0, 0, 0, 0.15);
  padding: 12px 28px;
  border-radius: 40px;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
  letter-spacing: 0.3px;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.btn-outline-pixel:hover {
  border-color: #007be5;
  color: #007be5;
  transform: translateY(-2px);
  box-shadow: 0 8px 20px -8px rgba(0, 123, 229, 0.25);
}

.btn-outline-pixel:active {
  transform: scale(0.94);
}

/* ---- HERO ---- */
.hero {
  display: flex;
  flex-direction: column;
  gap: 20px;
  margin-bottom: 56px;
}

.hero-badge {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  background: rgba(0, 123, 229, 0.08);
  border: 1px solid rgba(0, 123, 229, 0.2);
  padding: 6px 18px 6px 14px;
  border-radius: 60px;
  width: fit-content;
  font-size: 13px;
  color: #007be5;
  backdrop-filter: blur(4px);
  transition: all 0.3s ease;
}

.hero-badge:hover {
  background: rgba(0, 123, 229, 0.14);
  transform: scale(1.02);
}

.hero-badge .dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  background: #00a63e;
  border-radius: 50%;
  animation: pixbeads-pulse-dot 1.6s ease-in-out infinite;
}

@keyframes pixbeads-pulse-dot {

  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }

  50% {
    opacity: 0.5;
    transform: scale(0.7);
  }
}

.hero h1 {
  font-size: clamp(2.4rem, 7vw, 4.4rem);
  font-weight: 800;
  line-height: 1.15;
  max-width: 800px;
  color: #000;
  margin: 0;
}

.hero h1 .highlight {
  background: linear-gradient(135deg, #007be5, #00a0ff);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  color: transparent;
  position: relative;
}

.hero h1 .highlight::after {
  content: '🧩';
  font-size: 0.6em;
  margin-left: 10px;
  -webkit-text-fill-color: initial;
  color: initial;
  display: inline-block;
  animation: pixbeads-pulse-dot 2s ease-in-out infinite;
}

.hero p {
  font-size: 1.15rem;
  color: rgba(0, 0, 0, 0.55);
  max-width: 580px;
  line-height: 1.8;
  font-weight: 300;
  margin: 0;
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin-top: 8px;
}

/* ---- 区块 ---- */
.section {
  margin-bottom: 56px;
}

.section-title {
  font-family: 'Press Start 2P', monospace;
  font-size: 16px;
  color: #000;
  margin-bottom: 28px;
  letter-spacing: 1px;
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.section-title span {
  font-family: 'Segoe UI', 'PingFang SC', sans-serif;
  font-size: 14px;
  color: rgba(0, 0, 0, 0.4);
  font-weight: 300;
}

/* ---- 作品/功能网格 ---- */
.gallery {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 24px;
}

/* ---- 像素卡片 (浅色) ---- */
.pixel-card {
  background: rgba(255, 255, 255, 0.85);
  border-radius: 24px;
  padding: 24px 16px 20px;
  text-align: center;
  border: 1px solid rgba(0, 0, 0, 0.08);
  transition: all 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
  cursor: pointer;
  position: relative;
  overflow: hidden;
  backdrop-filter: blur(4px);
}

.pixel-card:hover {
  transform: translateY(-8px) scale(1.02);
  background: #fff;
  border-color: rgba(0, 123, 229, 0.25);
  box-shadow: 0 20px 40px -12px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 123, 229, 0.1) inset;
}

.pixel-card:active {
  transform: scale(0.94) translateY(2px);
  transition-duration: 0.08s;
}

.pixel-card .emoji-big {
  font-size: 48px;
  display: block;
  margin-bottom: 12px;
  filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.15));
  transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.pixel-card:hover .emoji-big {
  transform: scale(1.12) rotate(-4deg);
}

.pixel-card h4 {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 6px;
  color: #000;
}

.pixel-card p {
  font-size: 13px;
  color: rgba(0, 0, 0, 0.55);
  margin: 0;
  line-height: 1.6;
}

/* ---- 卡片内 "豆子" 装饰 ---- */
.pixel-dots {
  display: flex;
  justify-content: center;
  gap: 6px;
  margin-top: 14px;
  flex-wrap: wrap;
}

.pixel-dots span {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.08);
  transition: all 0.3s ease;
}

.pixel-card:hover .pixel-dots span {
  background: rgba(0, 123, 229, 0.2);
  transform: scale(1.15);
}

.pixel-card:hover .pixel-dots span:nth-child(1) {
  background: #e5484d;
  transition-delay: 0.02s;
}

.pixel-card:hover .pixel-dots span:nth-child(2) {
  background: #ff942f;
  transition-delay: 0.06s;
}

.pixel-card:hover .pixel-dots span:nth-child(3) {
  background: #30a46c;
  transition-delay: 0.10s;
}

.pixel-card:hover .pixel-dots span:nth-child(4) {
  background: #0091ff;
  transition-delay: 0.14s;
}

.pixel-card:hover .pixel-dots span:nth-child(5) {
  background: #6e56cf;
  transition-delay: 0.18s;
}

/* ---- 步骤卡片 ---- */
.step-card {
  padding: 28px 18px 24px;
}

.step-num {
  font-family: 'Press Start 2P', monospace;
  font-size: 26px;
  color: rgba(0, 0, 0, 0.15);
  display: block;
  margin-bottom: 10px;
  user-select: none;
}

.step-card:hover .step-num {
  color: rgba(0, 123, 229, 0.5);
}

/* ---- 技术特色卡片 ---- */
.tech-card {
  text-align: left;
  padding: 22px 20px;
}

.tech-card h4 {
  color: #007be5;
  margin-bottom: 8px;
}

/* ---- "+1" 飘字 (拼豆趣味反馈) ---- */
.plus-float {
  position: absolute;
  font-size: 20px;
  font-weight: 700;
  color: #007be5;
  pointer-events: none;
  z-index: 20;
  opacity: 1;
  transform: translateY(0) scale(0.8);
  animation: pixbeads-float-up 1s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
  text-shadow: 0 2px 12px rgba(0, 123, 229, 0.2);
}

@keyframes pixbeads-float-up {
  0% {
    opacity: 1;
    transform: translateY(0) scale(0.8);
  }

  100% {
    opacity: 0;
    transform: translateY(-80px) scale(1.4);
  }
}

/* ---- 页脚 ---- */
.footer {
  margin-top: 40px;
  padding-top: 28px;
  border-top: 1px solid rgba(0, 0, 0, 0.08);
  display: flex;
  flex-direction: column;
  gap: 28px;
  align-items: center;
}

.cta-block {
  text-align: center;
}

.cta-block h2 {
  font-size: 1.5rem;
  color: #000;
  margin: 0 0 20px;
}

.footer-row {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  font-size: 13px;
  color: rgba(0, 0, 0, 0.45);
}

.social {
  display: flex;
  align-items: center;
  gap: 16px;
}

.social a {
  display: inline-flex;
  align-items: center;
  color: rgba(0, 0, 0, 0.45);
  text-decoration: none;
  transition: color 0.25s ease, transform 0.2s ease;
  font-size: 20px;
  cursor: pointer;
}

.social a svg {
  display: block;
}

.social a:hover {
  color: #007be5;
  transform: translateY(-2px) scale(1.1);
}

.social a:active {
  transform: scale(0.88);
}

/* ---- 响应式 ---- */
@media (max-width: 640px) {
  .pixel-container {
    padding: 24px 20px 32px;
    border-radius: 32px;
  }

  .pixel-page {
    padding: 12px;
  }

  .navbar {
    flex-direction: column;
    align-items: stretch;
    gap: 20px;
  }

  .nav-links {
    justify-content: space-between;
    gap: 12px;
  }

  .nav-links>a:not(.btn-pixel) {
    font-size: 13px;
  }

  .btn-pixel {
    font-size: 10px;
    padding: 10px 18px;
  }

  .hero h1 {
    font-size: 2rem;
  }

  .gallery {
    grid-template-columns: repeat(2, 1fr);
    gap: 14px;
  }

  .pixel-card .emoji-big {
    font-size: 38px;
  }

  .footer-row {
    flex-direction: column;
    text-align: center;
  }
}

@media (max-width: 400px) {
  .gallery {
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .pixel-card {
    padding: 16px 10px;
  }

  .pixel-card .emoji-big {
    font-size: 30px;
  }
}

/* ---- 呼吸 keyframes (配合 JS 漂移, 只动 opacity) ---- */
@keyframes pixbeads-breathe {

  0%,
  100% {
    opacity: 0.5;
  }

  50% {
    opacity: 0.85;
  }
}

@keyframes pixbeads-breathe-slow {

  0%,
  100% {
    opacity: 0.5;
  }

  50% {
    opacity: 0.9;
  }
}

@keyframes pixbeads-breathe-slower {

  0%,
  100% {
    opacity: 0.5;
  }

  50% {
    opacity: 1;
  }
}

.pixbeads-breathe {
  animation: pixbeads-breathe 4s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

.pixbeads-breathe-slow {
  animation: pixbeads-breathe-slow 5s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

.pixbeads-breathe-slower {
  animation: pixbeads-breathe-slower 7s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

/* ---- 尊重用户动效偏好 ---- */
@media (prefers-reduced-motion: reduce) {

  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
</style>
