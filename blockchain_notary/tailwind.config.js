/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./electron/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // Токены определены как CSS-переменные в index.css — так одна и та же
      // утилита (bg-panel и т.п.) работает в обеих темах без дублирования классов
      colors: {
        bg: "var(--bg)",
        panel: "var(--panel)",
        panel2: "var(--panel2)",
        line: "var(--border)",
        line2: "var(--border2)",
        ink: "var(--text)",
        muted: "var(--muted)",
        faint: "var(--faint)",
        accent: "var(--accent)",
        "accent-hi": "var(--accent-hi)",
        "on-accent": "var(--on-accent)",
        "accent-bg": "var(--accent-bg)",
        ok: "var(--ok)",
        "ok-bg": "var(--ok-bg)",
        warn: "var(--warn)",
        "warn-bg": "var(--warn-bg)",
        info: "var(--info)",
        "info-bg": "var(--info-bg)",
        err: "var(--err)",
        "err-bg": "var(--err-bg)",
        blossom: "var(--blossom)",
        "row-hover": "var(--row-hover)",
      },
    },
  },
  plugins: [],
}
