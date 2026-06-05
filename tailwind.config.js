/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      colors: {
        bg: 'var(--color-bg)',
        text: 'var(--color-text)',
        'text-secondary': 'var(--color-text-secondary)',
        border: 'var(--color-border)',
        'btn-primary-bg': 'var(--color-btn-primary-bg)',
        'btn-primary-text': 'var(--color-btn-primary-text)',
        'btn-secondary-bg': 'var(--color-btn-secondary-bg)',
        'focus-ring': 'var(--color-focus-ring)',
        'tooltip-bg': 'var(--color-tooltip-bg)',
        'tooltip-text': 'var(--color-tooltip-text)',
        'sidebar-bg': 'var(--color-sidebar-bg)',
        success: 'var(--color-success)',
        error: 'var(--color-error)',
        info: 'var(--color-info)',
      },
    },
  },
  plugins: [],
}
