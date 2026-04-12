import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, ConfigProvider, Form, Input, Layout, Typography, theme as antdTheme } from 'antd'
import { LockOutlined, UserOutlined } from '@ant-design/icons'
import { setToken } from './adminAuth'
import useStore from '../store'

export default function AdminLogin() {
  const navigate = useNavigate()
  const themeMode = useStore((s) => s.theme)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const appTheme = React.useMemo(
    () => ({
      algorithm: themeMode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
      token: {
        colorPrimary: themeMode === 'dark' ? '#7ab2ff' : '#0f62fe',
        borderRadius: 16,
        fontFamily: 'Manrope, "Noto Sans SC", "PingFang SC", sans-serif',
      },
    }),
    [themeMode],
  )

  async function onFinish(values: { username: string; password: string }) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      if (!res.ok) {
        setError('Invalid username or password.')
        return
      }
      const data = await res.json()
      setToken(data.token)
      navigate('/admin', { replace: true })
    } catch (_) {
      setError('Connection error, please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <ConfigProvider theme={appTheme}>
      <Layout style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="hei-orb hei-orb-a" />
        <div className="hei-orb hei-orb-b" />
        <Layout.Content style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
          <div style={{ width: 360, padding: '40px 32px', borderRadius: 24, background: 'var(--hei-card-bg, rgba(255,255,255,0.85))', boxShadow: '0 8px 32px rgba(0,0,0,0.12)', backdropFilter: 'blur(16px)' }}>
            <div style={{ textAlign: 'center', marginBottom: 32 }}>
              <img src="/heiView_logo.png" alt="heiView" style={{ height: 40, marginBottom: 8 }} />
              <Typography.Title level={4} style={{ margin: 0 }}>Admin Login</Typography.Title>
            </div>

            {error && (
              <div style={{ marginBottom: 16, padding: '8px 12px', borderRadius: 8, background: '#fff2f0', border: '1px solid #ffccc7', color: '#ff4d4f', fontSize: 14 }}>
                {error}
              </div>
            )}

            <Form layout="vertical" onFinish={onFinish} autoComplete="off">
              <Form.Item name="username" rules={[{ required: true, message: 'Please enter username' }]}>
                <Input prefix={<UserOutlined />} placeholder="Username" size="large" />
              </Form.Item>
              <Form.Item name="password" rules={[{ required: true, message: 'Please enter password' }]}>
                <Input.Password prefix={<LockOutlined />} placeholder="Password" size="large" />
              </Form.Item>
              <Form.Item style={{ marginBottom: 0 }}>
                <Button type="primary" htmlType="submit" size="large" loading={loading} block>
                  Log in
                </Button>
              </Form.Item>
            </Form>
          </div>
        </Layout.Content>
      </Layout>
    </ConfigProvider>
  )
}
