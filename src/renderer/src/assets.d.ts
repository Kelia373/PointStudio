// 让 TypeScript 接受 CSS 的副作用导入（Vite 构建时会真正处理它）。
declare module '*.css' {
  const content: string
  export default content
}
