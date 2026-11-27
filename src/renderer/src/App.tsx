import ChatPanel from './components/ChatPanel'

// 根组件只做装配：现在只有一块面板，将来多页时在这里挂路由。
export default function App() {
  return <ChatPanel />
}
