# Pixbeads 拼豆图纸生成器

一款跨平台的拼豆图纸生成工具，帮助拼豆爱好者将任意图片快速转换为标准拼豆图纸。所有计算均在本地完成，无需网络，保护隐私。

## 功能特点

### 核心功能
- **图片上传**：支持拖放或点击选择 JPG/PNG 图片
- **智能像素化**：可调粒度（10-200），支持卡通（主色）和真实（均色）两种模式
- **Oklab 色彩匹配**：基于感知均匀色彩空间的最近色匹配，效果优于 RGB 欧氏距离
- **BFS 区域合并**：自动合并相邻相似颜色，减少杂色，平滑色块
- **背景移除**：从边界洪水填充，自动识别并移除背景区域

### 色号系统
- 支持 5 种店家色号体系：MARD、COCO、漫漫、盼盼、咪小窝
- 291 种标准颜色，通过 `colorSystemMapping.json` 统一管理
- 支持自定义色板（勾选/取消勾选自有颜色）
- 色板选择自动保存到 localStorage

### 编辑工具
- **手动编辑**：画笔、吸管、橡皮擦
- **区域擦除**：一键擦除同色连通区域（洪水填充）
- **颜色替换**：批量替换指定颜色
- **撤销/重做**：支持 50 步历史（Ctrl+Z / Ctrl+Shift+Z）
- **悬浮调色盘**：可拖拽的浮动面板，工具+颜色网格

### 专心拼豆模式
游戏化的拼豆制作指导系统：
- 灰度背景 + 当前颜色高亮
- 完成标记（绿色勾选）
- 3 种引导模式：最近优先、最大优先、边缘优先
- 推荐区域高亮（红色虚线框）
- 计时器（暂停/继续）
- 颜色完成自动切换
- 分区网格线辅助

### 导出功能
- **带 Key 图纸**：包含色号编码和网格线的 PNG 图纸
- **颜色统计图**：包含各颜色色块、色号、数量的统计图
- **CSV 导出**：像素数据的 CSV 格式导出

### 其他功能
- **放大镜工具**：框选区域放大编辑
- **自定义色板编辑器**：搜索、分组、全选/取消
- **庆祝动画**：颜色完成时的粒子效果
- **完成打卡图**：全部完成时的缩略图+用时统计
- **打赏支持**：微信二维码打赏
- **PWA 支持**：可安装为桌面应用

## 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| Tauri | 2.x | 桌面应用框架 |
| Vue | 3.4+ | 前端框架 |
| Vite | 5.2+ | 构建工具 |
| Tailwind CSS | 3.4+ | 样式系统 |
| Rust | - | 桌面端后端（当前为脚手架） |

## 开发

### 前置要求
- Node.js 18+
- Bun（推荐）或 npm
- Rust（仅桌面端开发需要）

### 安装依赖
```bash
# 使用 Bun（推荐）
bun install

# 或使用 npm
npm install
```

### 启动开发服务器
```bash
# Web 端开发（端口 1420）
bun run dev

# 完整桌面端开发（Vite + Rust）
bun run tauri dev
```

### 构建
```bash
# Web 端构建
bun run build

# 完整桌面端构建
bun run tauri build
```

## 项目结构

```
Pixbeads/
├── src/                          # Vue 3 前端
│   ├── App.vue                   # 主页面（~1270行）
│   ├── main.js                   # 入口（含路由逻辑）
│   ├── style.css                 # Tailwind CSS 引入
│   ├── views/
│   │   └── FocusMode.vue         # 专心拼豆模式页面
│   ├── components/               # 16 个 Vue 组件
│   │   ├── FocusCanvas.vue       # 游戏化画布
│   │   ├── ColorStatusBar.vue    # 颜色状态栏
│   │   ├── ProgressBar.vue       # 进度条
│   │   ├── FocusToolBar.vue      # 工具栏
│   │   ├── FocusColorPanel.vue   # 颜色面板
│   │   ├── MagnifierTool.vue     # 放大镜工具
│   │   ├── SettingsPanel.vue     # 设置面板
│   │   ├── DonationModal.vue     # 打赏弹窗
│   │   ├── CustomPaletteEditor.vue # 色板编辑器
│   │   ├── CelebrationAnimation.vue # 庆祝动画
│   │   ├── CompletionCard.vue    # 完成打卡
│   │   ├── FocusModePreDownloadModal.vue # 预下载提醒
│   │   ├── DownloadSettingsModal.vue     # 下载设置
│   │   ├── ColorPalette.vue      # 颜色面板组件
│   │   ├── ColorPanel.vue        # 颜色选择面板
│   │   └── InstallPWA.vue        # PWA 安装提示
│   ├── composables/              # Vue 3 Composables
│   │   ├── useManualEditingState.js   # 编辑状态管理
│   │   └── usePixelEditingOperations.js # 编辑操作封装
│   ├── utils/                    # 工具函数
│   │   ├── pixelation.js         # 像素化核心算法
│   │   ├── colorSystemUtils.js   # 色号系统工具
│   │   ├── floodFillUtils.js     # 连通区域检测
│   │   ├── downloader.js         # 导出功能
│   │   ├── canvasUtils.js        # 画布坐标转换
│   │   ├── localStorageUtils.js  # 本地存储管理
│   │   └── pixelEditingUtils.js  # 像素编辑桥接
│   └── data/
│       └── colorSystemMapping.json # 291色 x 5店家映射
├── src-tauri/                    # Rust 后端（脚手架）
├── public/                       # 静态资源
├── package.json
├── vite.config.js
├── tailwind.config.js
└── postcss.config.js
```

## 核心算法

### 1. 初始颜色映射
- 加载图片后，根据粒度参数划分 N×M 网格
- 对每个单元格，找出区域内出现频率最高的像素色（Dominant）或计算平均色（Average）
- 使用 Oklab 色彩空间的欧氏距离匹配最近的拼豆颜色

### 2. 区域颜色合并
- 使用 BFS 遍历网格，识别颜色相似（欧氏距离 < 阈值）的连通区域
- 将每个区域内所有单元格统一设置为该区域出现次数最多的颜色

### 3. 背景移除 
- 定义背景色号列表
- 从图像所有边界单元格开始执行洪水填充
- 将所有与边界连通且颜色属于背景色的单元格标记为"外部"

### 4. 颜色排除与重映射
- 用户排除某颜色后，仅在已存在且未被排除的颜色中寻找替换色
- 将所有使用被排除颜色的单元格重新映射到最近邻色

## 路由

项目不使用 vue-router，而是通过 `main.js` 中的路径判断实现简单路由：

- `/` → App.vue（主页面）
- `/focus` → FocusMode.vue（专心拼豆模式）

专心模式通过 localStorage 传递像素数据。

## 许可证

Apache 2.0
