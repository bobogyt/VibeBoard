import { useEffect, useState } from 'react'
import { App as AntdApp, AutoComplete, Button, Input, Modal, Popconfirm, Select, Space, Tag } from 'antd'
import { api } from '../lib/api'
import type { AgentModelsInfo } from '../lib/api'

interface ModelSettingsModalProps {
  open: boolean
  onClose: () => void
}

/** 模型设置弹窗:选供应商 → 填 API Key(已存可留空)→ 选模型(预设 + 可自行输入)→ 保存并使用 */
export default function ModelSettingsModal({ open, onClose }: ModelSettingsModalProps) {
  const { message } = AntdApp.useApp()
  const [info, setInfo] = useState<AgentModelsInfo | null>(null)
  const [provider, setProvider] = useState<string>()
  const [model, setModel] = useState<string>('')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    api
      .getAgentModels()
      .then((data) => {
        if (cancelled) return
        setInfo(data)
        setProvider((prev) => prev ?? data.active?.provider ?? data.providers[0]?.id)
        setModel((prev) => prev || data.active?.model || data.providers[0]?.models[0] || '')
      })
      .catch((e: unknown) => {
        if (!cancelled) message.error(e instanceof Error ? e.message : '加载模型配置失败')
      })
    return () => {
      cancelled = true
    }
  }, [open, message])

  const providerInfo = info?.providers.find((p) => p.id === provider)
  const configuredEntry = provider ? info?.configured[provider] : undefined

  const switchProvider = (id: string) => {
    setProvider(id)
    const next = info?.providers.find((p) => p.id === id)
    setModel(next?.models[0] ?? '')
    setApiKey('')
  }

  const save = async () => {
    if (!provider || !model.trim() || saving) return
    setSaving(true)
    try {
      const data = await api.saveAgentModel({ provider, model: model.trim(), apiKey: apiKey.trim() || undefined })
      setInfo(data)
      setApiKey('')
      const label = data.providers.find((p) => p.id === data.active?.provider)?.label ?? data.active?.provider
      message.success(`已切换到 ${label} · ${data.active?.model}`)
      onClose()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const removeKey = async () => {
    if (!provider) return
    try {
      const data = await api.deleteAgentModel(provider)
      setInfo(data)
      message.success('已清除该供应商的密钥')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '清除失败')
    }
  }

  const activeLabel = info?.active
    ? `${info.providers.find((p) => p.id === info.active?.provider)?.label ?? info.active.provider} · ${info.active.model}` +
      (info.active.source === 'env' ? '(来自 server/.env)' : '')
    : null

  return (
    <Modal
      title="模型设置"
      open={open}
      onCancel={onClose}
      footer={null}
      width={420}
      destroyOnHidden
    >
      <p className="model-settings__active">
        当前生效:
        {activeLabel ? <Tag color="processing">{activeLabel}</Tag> : <Tag>未配置</Tag>}
      </p>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <div>
          <div className="model-settings__label">供应商</div>
          <Select
            style={{ width: '100%' }}
            value={provider}
            onChange={switchProvider}
            options={(info?.providers ?? []).map((p) => ({ value: p.id, label: p.label }))}
            placeholder="选择模型供应商"
          />
        </div>
        <div>
          <div className="model-settings__label">API Key</div>
          <Input.Password
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={
              configuredEntry ? `已保存(${configuredEntry.keyHint}),留空则沿用` : '粘贴该供应商的 API Key'
            }
            autoComplete="new-password"
          />
        </div>
        <div>
          <div className="model-settings__label">模型(可选预设,也可自行输入)</div>
          <AutoComplete
            style={{ width: '100%' }}
            value={model}
            onChange={(v) => setModel(v)}
            options={(providerInfo?.models ?? []).map((m) => ({ value: m }))}
            placeholder="如 deepseek-chat"
          />
        </div>
        <Button type="primary" block loading={saving} disabled={!provider || !model.trim()} onClick={() => void save()}>
          保存并使用
        </Button>
        {configuredEntry && (
          <Popconfirm
            title="清除该供应商已保存的密钥?"
            description="若它是当前生效配置,将回退到未配置状态"
            okText="清除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => void removeKey()}
          >
            <Button block danger type="text">
              清除该供应商密钥({configuredEntry.keyHint})
            </Button>
          </Popconfirm>
        )}
      </Space>
    </Modal>
  )
}
