// 让 TypeScript 接受 CSS 的副作用导入（Vite 构建时会真正处理它）。
declare module '*.css' {
  const content: string
  export default content
}

// `?raw` 导入：拿到 SVG 文件里的原始标记，再由 Icon 组件套上自己的外壳。
// 这样图标是资源文件（可单独替换），颜色与尺寸仍然由组件控制。
declare module '*.svg?raw' {
  const content: string
  export default content
}
