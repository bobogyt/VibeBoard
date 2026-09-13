import { useEffect, useState } from 'react'
import { App as AntdApp, Button, Input, Modal, Popconfirm, Space, Tag } from 'antd'
import { api } from '../lib/api'
import type { GithubConfigInfo } from '../lib/api'

interface GithubTokenModalProps {
  open: boolean
  onClose: () => void
}

/** GitHub Token 设置弹窗:公开仓库匿名可浏览;私有仓库/更高频率需配置 PAT(密文落库,只回掩码) */
export default function GithubTokenModal({ open, onClose }: GithubTokenModalProps) {
  const { message } = AntdApp.useApp()
  const [info, setInfo] = useState<GithubConfigInfo | null>(null)
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    api
      .getGithubConfig()
      .then((data) => {
        if (!cancelled) setInfo(data)
      })
      .catch((e: unknown) => {
        if (!cancelled) message.error(e instanceof Error ? e.message : '加载 GitHub 配置失败')
      })
    return () => {
      cancelled = true
    }
  }, [open, message])

  const save = async () => {
    if (saving) return
    setSaving(true)
    try {
      const data = await api.saveGithubToken(token.trim())
      setInfo(data)
      setToken('')
      message.success('GitHub Token 已保存')
      onClose()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    try {
      await api.deleteGithubToken()
      setInfo({ configured: false, tokenHint: null })
      message.success('已清除 GitHub Token')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '清除失败')
    }
  }

  return (
    <Modal title="GitHub Token" open={open} onCancel={onClose} footer={null} width={420} destroyOnHidden>
      <p className="model-settings__active">
        当前状态:
        {info?.configured ? <Tag color="processing">已配置({info.tokenHint})</Tag> : <Tag>未配置(公开仓库匿名访问)</Tag>}
      </p>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <div>
          <div className="model-settings__label">Personal Access Token</div>
          <Input.Password
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={info?.configured ? `已保存(${info.tokenHint}),留空则关闭` : '粘贴 GitHub PAT'}
            autoComplete="new-password"
          />
        </div>
        <div className="github-token__hint">
          公开仓库无需 Token 即可浏览;访问私有仓库或需要更高速率时配置。建议使用 fine-grained
          PAT 并仅授予目标仓库的只读权限。
        </div>
        <Button type="primary" block loading={saving} disabled={token.trim().length === 0} onClick={() => void save()}>
          保存 Token
        </Button>
        {info?.configured && (
          <Popconfirm
            title="清除已保存的 GitHub Token?"
            description="清除后私有仓库将无法访问"
            okText="清除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => void remove()}
          >
            <Button block danger type="text">
              清除 Token({info.tokenHint})
            </Button>
          </Popconfirm>
        )}
      </Space>
    </Modal>
  )
}
