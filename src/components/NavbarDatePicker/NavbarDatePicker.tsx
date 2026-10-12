import React from 'react'
import { DatePicker } from 'antd'
import type { Dayjs } from 'dayjs'

function NavbarDatePicker({ value, onChange }: {
  value: Dayjs
  onChange: (value: Dayjs | null) => void
}) {
  const [open, setOpen] = React.useState(false)
  const openBeforeClick = React.useRef(false)

  return (
    <DatePicker
      size="large"
      allowClear={false}
      value={value}
      onChange={onChange}
      open={open}
      onOpenChange={setOpen}
      // Capture before focus and the picker's default click handler open it.
      onMouseDown={() => { openBeforeClick.current = open }}
      onClick={() => setOpen(!openBeforeClick.current)}
      className="hei-topbar-date"
      aria-label="Choose date"
      title={value.format('YYYY-MM-DD')}
    />
  )
}

export default NavbarDatePicker
