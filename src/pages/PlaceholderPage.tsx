import { Empty } from 'antd'

interface PlaceholderPageProps {
  title: string
  description: string
}

export default function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  return (
    <div className="placeholder-page">
      <h2 className="placeholder-title">{title}</h2>
      <Empty description={description} />
    </div>
  )
}
