# 工具进程（utility process）

什么情况下该把活丢进独立进程、怎么做最小实现，以及和 worker_threads 的区别。

## 现状

**没有。** 目前所有主进程工作都跑在主进程里。

## 什么时候需要

某件活满足以下**任一**条件时，才值得开一个工具进程：

| 条件 | 例子 |
|---|---|
| CPU 密集，会卡住主进程事件循环 | PDF 解析、大文件分块、图像处理 |
| 依赖原生库，可能把进程搞崩 | OCR（PaddleOCR）、本地模型推理（ONNX Runtime） |
| 需要长期驻留，又不该占主进程资源 | 常驻的本地推理服务 |

**普通异步 IO 不需要**——读写文件、HTTP 请求不阻塞事件循环，多开一个进程只是增加通信成本。

## 为什么是 utilityProcess，而不是 worker_threads

| | `worker_threads` | `utilityProcess` |
|---|---|---|
| 隔离级别 | 同进程内的线程 | **独立进程** |
| 崩溃影响 | 可能拖垮主进程 | 只挂自己 |
| 原生库冲突 | 同进程，DLL 冲突会连锁 | 隔离 |
| Electron 支持 | Node 原生 | Electron 提供，带私有消息通道 |

**关键区别是崩溃隔离**。一个原生库把进程搞挂时，worker 版本的死法是主进程一起死；utilityProcess 版本只是那个子进程退出，主进程还在。

## 最小用法

主进程：

```ts
import { utilityProcess } from 'electron'

const child = utilityProcess.fork(
  path.join(__dirname, 'workers/ocr.js'),
  [],
  { serviceName: 'ocr' }
)

child.postMessage({ type: 'ocr', imagePath })
child.on('message', (result) => { /* 拿结果 */ })
child.on('exit', (code) => { /* 必须处理：崩了你得知道 */ })
```

子进程入口（`workers/ocr.ts`）：

```ts
process.parentPort.on('message', async (e) => {
  const result = await doOcr(e.data.imagePath)
  process.parentPort.postMessage(result)
})
```

子进程要**单独构建成一个独立入口**（在 electron-vite 的 rollup input 里加一项），不能和主进程打在一个 bundle 里——否则它会连主进程的启动代码一起执行。

## 反模式

- 用它跑普通异步 IO —— 白增一层进程通信
- 不处理 `exit` 事件 —— 子进程崩了没人知道，请求永远悬着
- 在子进程里读用户配置 —— 配置应由主进程通过 `postMessage` 传进去
- 把它当安全沙箱 —— 它只隔离**崩溃**，不隔离**代码**。不可信的代码需要真正的沙箱，不是这里

## 相关

- 主进程目录：[main-architecture.md](./main-architecture.md)
