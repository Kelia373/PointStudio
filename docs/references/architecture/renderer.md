# 渲染进程结构（`src/renderer`）

渲染层的目录约定、组件组织方式，以及「界面不碰数据」这条硬规则。


## 现状

已有一块可用的聊天面板：`components/ChatPanel.tsx`（状态 + 订阅主进程推流）、`components/MessageBubble.tsx`（纯展示，只有 props）、`styles/app.css`。仍然没有组件库、没有路由、没有状态管理方案——状态还在组件内部的 `useState`，够用就不引。

## 唯一一条硬规则

**渲染进程不直接碰文件、数据库、模型 API。全部经 IPC 走主进程。**

理由不只是安全：渲染进程本来就是浏览器环境，没有 Node 能力；一旦为了省事打开 `nodeIntegration`，界面和业务会迅速糊在一起，之后想拆就拆不开。

## 目录约定（需要时才建）

```
src/renderer/
├── index.html
└── src/
    ├── main.tsx          React 入口
    ├── App.tsx           根组件
    ├── pages/            页面，一个页面一个文件或目录
    ├── components/       可复用组件
    ├── hooks/            自定义 hook
    └── styles/           全局样式
```

**默认不要建任何目录。** 第一个页面出现时建 `pages/`，第一个复用组件出现时建 `components/`。空目录不提供任何价值，只会诱使人往里塞东西。

### 组件：单文件还是目录

- 单文件组件保持扁平：`components/MessageBubble.tsx`
- 只有它带上私有子组件 / hook / 样式时才建目录：

```
components/MessageBubble/
├── index.ts            再导出（.ts 不是 .tsx —— 它没有 JSX）
├── MessageBubble.tsx   主实现（不要叫 index.tsx）
└── useBubbleSize.ts    私有 hook
```

### 页面之间不许互相 import

`pages/A` import `pages/B` 是跨页耦合——改 B 会炸 A。共用部分下沉到 `components/` 或 `hooks/`，让两个页面各自去 import。

## 反模式

- 在组件里直接调模型 API —— 走主进程
- 在组件里读写文件 —— 同上
- 页面 import 另一个页面
- 为一个组件预建目录
- 把业务逻辑写进组件（那属于 `src/main/ai/`）

## 相关

- 主进程目录与依赖方向：[main-architecture.md](./main-architecture.md)
- 跨进程共享类型：[shared-layer.md](./shared-layer.md)
