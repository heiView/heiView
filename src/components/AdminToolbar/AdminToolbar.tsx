import React from 'react'
import { Button, Popover } from 'antd'
import { MoreOutlined } from '@ant-design/icons'

function AdminToolbar({ children }: { children: React.ReactNode }) {
  const [compact, setCompact] = React.useState(() => window.matchMedia('(max-width: 1100px)').matches)
  const [open, setOpen] = React.useState(false)

  React.useEffect(() => {
    const media = window.matchMedia('(max-width: 1100px)')
    const update = () => { setCompact(media.matches); setOpen(false) }
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  if (!compact) return <div className="hei-admin-tools">{children}</div>
  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      open={open}
      onOpenChange={setOpen}
      content={<div className="hei-admin-tools-menu" onClick={() => setOpen(false)}>{children}</div>}
    >
      <Button
        type="text"
        size="large"
        className="hei-toolbar-icon-button"
        icon={<MoreOutlined />}
        aria-label="Admin actions"
        aria-expanded={open}
      />
    </Popover>
  )
}

export default AdminToolbar
