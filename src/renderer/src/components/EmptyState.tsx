// 空状态：给四张建议卡，点一张就把话填进输入框（不直接发送，用户可以改）。
// 卡片文案只承诺现有能力：普通对话、计划模式。没有「联网搜索」这类我们还没有的东西。
import BrandLogo from './BrandLogo'

const SUGGESTIONS = [
  {
    title: '拆验收清单',
    hint: '把一段需求拆成可勾选的验收项',
    text: '把这段需求拆成可执行的验收清单，每条都要能被验证：'
  },
  {
    title: '精简回复',
    hint: '保留结论，删掉铺垫',
    text: '帮我把下面这段改短，保留结论，删掉铺垫：'
  },
  {
    title: '解释报错',
    hint: '定位原因 + 最小修复',
    text: '解释这个报错，并给出最小修复：'
  },
  {
    title: '试一次计划',
    hint: '交给 Agent 生成步骤并逐步执行',
    text: '用计划模式跑一个目标：'
  }
]

export default function EmptyState({
  mode,
  onPick
}: {
  mode: 'live' | 'local' | null
  onPick: (text: string) => void
}) {
  const sub =
    mode === 'live'
      ? '已连上真模型。可以直接问，也可以点下面一张卡试试。'
      : mode === 'local'
        ? '当前没配 API Key，走本地假流式——链路和真模型一样，只是内容固定。'
        : '在设置里选好平台与 Key 之后，回答就是真模型的。'

  return (
    <div className="empty">
      <div className="empty__head">
        <BrandLogo variant="tile" size={40} className="empty__logo" />
        <h2 className="empty__title">今天想做什么</h2>
        <p className="empty__sub">{sub}</p>
      </div>

      <div className="empty__cards">
        {SUGGESTIONS.map((item) => (
          <button
            key={item.title}
            className="card-ask"
            type="button"
            onClick={() => onPick(item.text)}
          >
            <span className="card-ask__title">{item.title}</span>
            <span className="card-ask__hint">{item.hint}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
