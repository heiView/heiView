import React from 'react'
import { Button, Input, type InputRef } from 'antd'
import { CloseOutlined, SearchOutlined } from '@ant-design/icons'

function NavbarSearch({ value, onChange, placeholder }: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  const [expanded, setExpanded] = React.useState(false)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<InputRef>(null)
  const buttonRef = React.useRef<HTMLButtonElement>(null)
  const inputId = React.useId()

  React.useEffect(() => {
    if (!expanded) return
    // Wait until the animated field has room for a focusable input.
    const observer = new ResizeObserver(() => {
      const input = inputRef.current?.input
      if (!input || input.getBoundingClientRect().width <= 0 || getComputedStyle(input).visibility !== 'visible') return
      input.focus({ preventScroll: true })
      observer.disconnect()
    })
    if (containerRef.current) observer.observe(containerRef.current)
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setExpanded(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setExpanded(false)
      buttonRef.current?.focus({ preventScroll: true })
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      observer.disconnect()
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [expanded])

  return (
    <div ref={containerRef} className={`hei-toolbar-search${expanded ? ' is-expanded' : ''}`}>
      <div className="hei-search-input-panel" aria-hidden={!expanded}>
        <Input
          ref={inputRef}
          id={inputId}
          size="large"
          allowClear
          value={value}
          onChange={event => onChange(event.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          tabIndex={expanded ? 0 : -1}
          prefix={<SearchOutlined className="hei-toolbar-search-icon" />}
          className="hei-search-input"
        />
      </div>
      <Button
        ref={buttonRef}
        type="text"
        size="large"
        className="hei-toolbar-icon-button hei-search-toggle"
        icon={expanded ? <CloseOutlined /> : <SearchOutlined />}
        aria-label={expanded ? 'Close search' : 'Open search'}
        aria-expanded={expanded}
        aria-controls={inputId}
        title={expanded ? 'Close search (Esc)' : 'Search'}
        onClick={() => setExpanded(current => !current)}
      />
    </div>
  )
}

export default NavbarSearch
