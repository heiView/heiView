import React from 'react'
import { Button, Tooltip } from 'antd'
import { MoonOutlined, SunOutlined } from '@ant-design/icons'
import useStore from '../../store'

function DarkModeButton({ className }: { className?: string }) {
  const theme = useStore((state) => state.theme)
  const toggleTheme = useStore((state) => state.toggleTheme)
  const language = useStore((state) => state.language)

  const LABELS = {
    en: {
      toLight: 'Switch to light mode',
      toDark: 'Switch to dark mode',
    },
    zh: {
      toLight: '切换到浅色模式',
      toDark: '切换到深色模式',
    },
    de: {
      toLight: 'In den hellen Modus wechseln',
      toDark: 'In den dunklen Modus wechseln',
    },
  } as const;
  const activeLabels = LABELS[language] || LABELS.zh
  const label = theme === 'dark' ? activeLabels.toLight : activeLabels.toDark
  const Icon = theme === 'dark' ? SunOutlined : MoonOutlined

  return (
    <Tooltip title={label}>
      <Button
        type="text"
        shape="circle"
        size="large"
        className={className}
        onClick={toggleTheme}
        aria-label={label}
        aria-pressed={theme === 'dark'}
        icon={<Icon />}
      />
    </Tooltip>
  )
}

export default DarkModeButton
