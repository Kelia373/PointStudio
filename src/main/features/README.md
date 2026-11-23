# src/main/features

**职责**：大型业务领域，一个目录一个。

## 现在为空，这是刻意的

`features/` 是**成长出来的**，不是提前规划的。在没有一个大到必须独立成域的业务之前，这里保持空。

预创建 feature 目录的代价：一个空壳目录会吸引本不属于它的代码，最后变成杂物间——Cherry Studio 那边把这种情况叫「不要为一个预期中的模块预先创建 feature」。

## 什么时候才往里放

同时满足以下三条，才把一组代码收成 `features/<domain>/`：

1. 该领域已有**自己的页面 / 入口**，且横跨 components、hooks、services 多个形态；
2. 这些部件**主要在领域内部**被使用 —— 如果被到处复用，说明该下沉到共享层，而不是收进 feature；
3. 收进一个 barrel 后，跨目录的耦合是**减少**而不是换个地方。

## 与 `services/` 的分界

同一个业务，**体量**决定放哪：

```
services/<name>.ts      ← 单文件就够
   ↓ 一个文件装不下
services/<name>/        ← 原地变成子目录（内部可以有私有辅助文件）
   ↓ 长成多文件的大领域
features/<name>/        ← 才升级成 feature
```

**不要跳级**：小业务一开始就建 feature，等于给三行代码修一座厂房。

## 铁律

- 一个 feature 只暴露一个 `index.ts` 作为公共入口，内部文件外部不可直接 import；
- **feature 之间禁止互相 import** —— 要共享就下沉到 `services` 或 `utils`；
- feature 不得包含与领域无关的基础设施（那是 `core` / `data`）。

## 现状

空。
