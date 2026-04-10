import React from 'react'
import { Layout, ConfigProvider, Typography, Space, Card, Drawer, Avatar, Descriptions, theme as antdTheme } from 'antd'
import { UserOutlined } from '@ant-design/icons'
import useStore from './store'
import DarkModeButton from './components/DarkModeButton/DarkModeButton'
import './styles.css'

const Team: React.FC = () => {
  const theme = useStore((state) => state.theme)

  const appTheme = React.useMemo(
    () => ({
      algorithm: theme === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
      token: {
        colorPrimary: theme === 'dark' ? '#7ab2ff' : '#0f62fe',
        borderRadius: 16,
        fontFamily: 'Manrope, "Noto Sans SC", "PingFang SC", sans-serif',
      },
    }),
    [theme]
  )

  React.useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark')
    } else {
      document.documentElement.removeAttribute('data-theme')
    }
  }, [theme])

  return (
    <ConfigProvider theme={appTheme}>
      <Layout className="hei-layout">
        <div className="hei-orb hei-orb-a" />
        <div className="hei-orb hei-orb-b" />

        <Layout.Content className="hei-content">
          <header className="hei-topbar">
            <div className="hei-topbar-inner" style={{ justifyContent: 'space-between' }}>
              <div className="hei-brand-cluster">
                <div className="hei-brand-row">
                  <a href="/" style={{ display: 'flex', alignItems: 'center' }}>
                    <img src="/heiView_logo.png" alt="heiView" className="hei-brand-logo" />
                  </a>
                </div>
              </div>
              
              <div className="hei-toolbar-actions">
                <Space size="middle" wrap align="center">
                  <DarkModeButton className="hei-toolbar-icon-button" />
                </Space>
              </div>
            </div>
          </header>

          <div className="hei-shell" style={{ maxWidth: '800px', margin: '0 auto', padding: '24px' }}>
            <section className="hei-board-card" style={{ padding: '40px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <Typography.Title level={1}>About Us</Typography.Title>
              <Typography.Paragraph type="secondary" style={{ marginBottom: 40, textAlign: 'center' }}>
                Meet the minds behind heiView.
              </Typography.Paragraph>

              <Card 
                hoverable
                style={{ width: '100%', maxWidth: '280px', textAlign: 'center', borderRadius: 16, overflow: 'hidden' }}
                cover={
                  <img 
                    alt="Xin" 
                    src="https://i.imgur.com/Wn8Unqs.jpeg" 
                    style={{ aspectRatio: '1 / 1', width: '100%', objectFit: 'cover', objectPosition: 'center' }} 
                  />
                }
                styles={{ body: { padding: '24px' } }}
              >
                <Typography.Title level={3} style={{ margin: 0 }}>Xin</Typography.Title>
                <Typography.Text type="secondary">
                  Developer & Student
                </Typography.Text>
              </Card>

              <Typography.Title level={4} style={{ marginTop: 48, fontWeight: 400, color: 'var(--hei-text-secondary)' }}>
                I am looking forward to seeing you on this page!
              </Typography.Title>
            </section>
          </div>
        </Layout.Content>

        <Layout.Footer className="hei-footer">
          <div className="hei-footer-inner">
            <div className="hei-footer-content">
              <div className="hei-footer-section hei-footer-brand">
                  <img src="/heiView_logo.png" alt="heiView" className="hei-footer-logo" />
                <ul>
                  <li className="hei-footer-copyright">
                    © {new Date().getFullYear()}
                  </li>
                </ul>
              </div>

              <div className="hei-footer-section">
                <h4>Support</h4>
                <ul>
                  <li><a href="/#faq">FAQ</a></li>
                  <li><a href="/#feedback">Feedback</a></li>
                  <li><a href="/imprint">Imprint</a></li>
                  <li><a href="/privacy">Privacy Policy</a></li>
                </ul>
              </div>

              <div className="hei-footer-section">
                <h4>Developers</h4>
                <ul>
                  <li><a href="https://github.com/heiView/heiView" target="_blank" rel="noopener noreferrer">GitHub</a></li>
                </ul>
              </div>

              <div className="hei-footer-section">
                <h4>About</h4>
                <ul>
                  <li><a href="/about">About Us</a></li>
                  <li><a href="/#joinus">Join Us</a></li>
                  <li><a href="/#contact">Contact</a></li>
                </ul>
              </div>
            </div>
          </div>
        </Layout.Footer>
      </Layout>
    </ConfigProvider>
  )
}

export default Team