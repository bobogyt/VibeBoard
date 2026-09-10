import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Button, Card, Form, Input, App as AntdApp } from 'antd'
import type { FormEvent } from 'react'
import { useAuthContext } from '../hooks/useAuthContext'

type Mode = 'login' | 'register'

interface FormValues {
  username: string
  password: string
}

export default function LoginPage() {
  const { login, register } = useAuthContext()
  const { message } = AntdApp.useApp()
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('login')
  const [submitting, setSubmitting] = useState(false)

  const isLogin = mode === 'login'

  const handleSubmit = async (values: FormValues) => {
    if (submitting) return
    setSubmitting(true)
    try {
      if (isLogin) {
        await login(values.username.trim(), values.password)
      } else {
        await register(values.username.trim(), values.password)
      }
      navigate('/board', { replace: true })
    } catch (err) {
      message.error(err instanceof Error ? err.message : '操作失败,请重试')
    } finally {
      setSubmitting(false)
    }
  }

  const switchMode = (_e: FormEvent) => {
    setMode(isLogin ? 'register' : 'login')
  }

  return (
    <div className="auth">
      <Card className="auth-card">
        <h1 className="auth-logo">VibeBoard</h1>
        <p className="auth-subtitle">{isLogin ? '登录以继续' : '创建一个新账号'}</p>
        <Form<FormValues> layout="vertical" onFinish={handleSubmit} requiredMark={false}>
          <Form.Item
            label="用户名"
            name="username"
            rules={[
              { required: true, message: '请输入用户名' },
              { pattern: /^[\w.-]{3,32}$/, message: '3-32 位字母、数字、_ . -' },
            ]}
          >
            <Input placeholder="3-32 位字母、数字、_ . -" maxLength={32} autoComplete="username" autoFocus />
          </Form.Item>
          <Form.Item
            label="密码"
            name="password"
            rules={[
              { required: true, message: '请输入密码' },
              { min: 8, max: 128, message: '密码长度需在 8-128 位之间' },
            ]}
          >
            <Input.Password
              placeholder="至少 8 位"
              maxLength={128}
              autoComplete={isLogin ? 'current-password' : 'new-password'}
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={submitting} style={{ marginTop: 4 }}>
            {isLogin ? '登录' : '注册'}
          </Button>
        </Form>
        <Button type="link" block onClick={switchMode} style={{ marginTop: 8 }}>
          {isLogin ? '没有账号?注册一个' : '已有账号?直接登录'}
        </Button>
      </Card>
    </div>
  )
}
