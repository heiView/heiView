import React from 'react'
import { Layout, ConfigProvider, Typography, Space, theme as antdTheme } from 'antd'
import useStore from './store'
import DarkModeButton from './components/DarkModeButton/DarkModeButton'
import './styles.css'

const Imprint: React.FC = () => {
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
            <section className="hei-board-card" style={{ padding: '40px' }}>
              <Typography>
                <Typography.Title level={1}>Imprint / Impressum</Typography.Title>
                <Typography.Paragraph type="secondary">
                  Last updated: {new Date().toLocaleDateString('de-DE')}
                </Typography.Paragraph>

                <Typography.Title level={2}>Angaben gemäß § 5 TMG</Typography.Title>
                <Typography.Paragraph>
                  <strong>Mengbi Yu</strong><br/>
                  Robacher Str. 110<br/>
                  69126 Heidelberg<br/>
                  Deutschland
                </Typography.Paragraph>

                <Typography.Title level={3}>Kontakt</Typography.Title>
                <Typography.Paragraph>
                  Telefon: 015228030743<br/>
                  E-Mail: mengxibitan.yu@gmail.com
                </Typography.Paragraph>

                <Typography.Paragraph type="secondary" style={{ marginTop: '24px' }}>
                  Quelle: <a href="https://www.e-recht24.de" target="_blank" rel="noreferrer">e-recht24.de</a>
                </Typography.Paragraph>

                <Typography.Title level={2}>Disclaimer</Typography.Title>
                <Typography.Title level={3}>Liability for Contents</Typography.Title>
                <Typography.Paragraph>
                  As service providers, we are liable for own contents of these websites according to Sec. 7, paragraph 1 German Telemedia Act (TMG). However, according to Sec. 8 to 10 German Telemedia Act (TMG), service providers are not obligated to permanently monitor submitted or stored information or to search for evidences that indicate illegal activities.
                </Typography.Paragraph>

              </Typography>
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

export default Imprint
