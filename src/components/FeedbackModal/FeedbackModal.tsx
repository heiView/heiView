import React from 'react'
import {
  Button,
  DatePicker,
  Form,
  Input,
  Modal,
  Select,
  Space,
  TimePicker,
  Typography,
  Upload,
  message as antdMessage,
} from 'antd'
import { PlusOutlined, DeleteOutlined, UploadOutlined } from '@ant-design/icons'
import type { UploadFile } from 'antd'
import type { RcFile } from 'antd/es/upload'
import dayjs from 'dayjs'

const { TextArea } = Input

const DAY_OPTIONS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 7, label: 'Sunday' },
]

type ProposedWeek = {
  day_of_week: number | null
  start_time: string
  end_time: string
  start_date: string | null
  end_date: string | null
  room: string
  building: string
  note: string
}

type FeedbackModalProps = {
  open: boolean
  courseId: string
  courseTitle: string
  onClose: () => void
}

export default function FeedbackModal({ open, courseId, courseTitle, onClose }: FeedbackModalProps) {
  const [form] = Form.useForm()
  const [weeks, setWeeks] = React.useState<ProposedWeek[]>([])
  const [fileList, setFileList] = React.useState<UploadFile[]>([])
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    if (!open) {
      form.resetFields()
      setWeeks([])
      setFileList([])
    }
  }, [open, form])

  function addWeek() {
    setWeeks(prev => [
      ...prev,
      { day_of_week: null, start_time: '', end_time: '', start_date: null, end_date: null, room: '', building: '', note: '' },
    ])
  }

  function removeWeek(idx: number) {
    setWeeks(prev => prev.filter((_, i) => i !== idx))
  }

  function updateWeek(idx: number, field: keyof ProposedWeek, value: unknown) {
    setWeeks(prev => prev.map((w, i) => i === idx ? { ...w, [field]: value } : w))
  }

  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff', 'application/pdf']

  function beforeUpload(file: RcFile): boolean {
    if (!ALLOWED_TYPES.includes(file.type)) {
      antdMessage.error('Only images (JPG, PNG, GIF, WebP) and PDF files are allowed')
      return false
    }
    if (file.size > 2 * 1024 * 1024) {
      antdMessage.error('File must be smaller than 2MB')
      return false
    }
    return false // prevent auto-upload; we handle it ourselves
  }

  async function handleSubmit() {
    let values: Record<string, unknown>
    try {
      values = await form.validateFields()
    } catch (_) {
      return
    }

    setSubmitting(true)
    try {
      const formData = new FormData()
      formData.append('courseId', courseId)
      formData.append('courseTitle', courseTitle)
      if (values.email) formData.append('email', String(values.email))
      if (values.message) formData.append('message', String(values.message))

      const cleanedWeeks = weeks.filter(w => w.start_time || w.room || w.day_of_week)
      if (cleanedWeeks.length > 0) {
        formData.append('proposedWeeks', JSON.stringify(cleanedWeeks))
      }

      for (const uf of fileList) {
        if (uf.originFileObj) {
          formData.append('files', uf.originFileObj)
        }
      }

      const res = await fetch('/api/feedback', { method: 'POST', body: formData })
      if (!res.ok) {
        const err = await res.json()
        antdMessage.error(err.error || 'Failed to submit feedback')
        return
      }
      antdMessage.success('Thank you! Your feedback has been submitted.')
      onClose()
    } catch (_) {
      antdMessage.error('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title="Report Course Error"
      footer={[
        <Button key="cancel" onClick={onClose}>Cancel</Button>,
        <Button key="submit" type="primary" loading={submitting} onClick={handleSubmit}>
          Submit
        </Button>,
      ]}
      width={620}
      destroyOnClose
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          Course: <strong>{courseTitle}</strong>
        </Typography.Text>

        <Form form={form} layout="vertical" size="small">
          {/* Proposed schedule corrections */}
          <Form.Item label={<strong>Proposed Corrections (optional)</strong>} style={{ marginBottom: 0 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
              If the course time or room is wrong, you can propose the correct values below.
            </Typography.Text>
          </Form.Item>

          {weeks.map((week, idx) => (
            <div
              key={idx}
              style={{
                border: '1px solid var(--hei-border, #d9d9d9)',
                borderRadius: 8,
                padding: '8px 12px 4px',
                marginBottom: 8,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 2 }}>
                <Button
                  size="small"
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => removeWeek(idx)}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
                <Form.Item label="Day of week" style={{ marginBottom: 8 }}>
                  <Select
                    placeholder="Select day"
                    options={DAY_OPTIONS}
                    value={week.day_of_week ?? undefined}
                    onChange={v => updateWeek(idx, 'day_of_week', v)}
                  />
                </Form.Item>
                <Form.Item label="Room" style={{ marginBottom: 8 }}>
                  <Input
                    placeholder="e.g. HS 1"
                    value={week.room}
                    onChange={e => updateWeek(idx, 'room', e.target.value)}
                  />
                </Form.Item>
                <Form.Item label="Start time" style={{ marginBottom: 8 }}>
                  <TimePicker
                    format="HH:mm"
                    minuteStep={15}
                    style={{ width: '100%' }}
                    value={week.start_time ? dayjs(week.start_time, 'HH:mm') : null}
                    onChange={t => updateWeek(idx, 'start_time', t ? t.format('HH:mm') : '')}
                  />
                </Form.Item>
                <Form.Item label="End time" style={{ marginBottom: 8 }}>
                  <TimePicker
                    format="HH:mm"
                    minuteStep={15}
                    style={{ width: '100%' }}
                    value={week.end_time ? dayjs(week.end_time, 'HH:mm') : null}
                    onChange={t => updateWeek(idx, 'end_time', t ? t.format('HH:mm') : '')}
                  />
                </Form.Item>
                <Form.Item label="Start date" style={{ marginBottom: 8 }}>
                  <DatePicker
                    style={{ width: '100%' }}
                    value={week.start_date ? dayjs(week.start_date) : null}
                    onChange={d => updateWeek(idx, 'start_date', d ? d.format('YYYY-MM-DD') : null)}
                  />
                </Form.Item>
                <Form.Item label="End date" style={{ marginBottom: 8 }}>
                  <DatePicker
                    style={{ width: '100%' }}
                    value={week.end_date ? dayjs(week.end_date) : null}
                    onChange={d => updateWeek(idx, 'end_date', d ? d.format('YYYY-MM-DD') : null)}
                  />
                </Form.Item>
              </div>
              <Form.Item label="Building" style={{ marginBottom: 8 }}>
                <Input
                  placeholder="e.g. Mathematikon A, Im Neuenheimer Feld 205"
                  value={week.building}
                  onChange={e => updateWeek(idx, 'building', e.target.value)}
                />
              </Form.Item>
              <Form.Item label="Note" style={{ marginBottom: 8 }}>
                <Input
                  placeholder="Optional note"
                  value={week.note}
                  onChange={e => updateWeek(idx, 'note', e.target.value)}
                />
              </Form.Item>
            </div>
          ))}

          <Button
            size="small"
            icon={<PlusOutlined />}
            onClick={addWeek}
            style={{ marginBottom: 16 }}
          >
            Add corrected time slot
          </Button>

          {/* Upload proof */}
          <Form.Item label={<strong>Upload Proof (optional)</strong>} style={{ marginBottom: 8 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
              Screenshots, PDFs, or other documents showing the correct schedule.
            </Typography.Text>
            <Upload
              fileList={fileList}
              beforeUpload={beforeUpload}
              onChange={({ fileList: newList }) => setFileList(newList.slice(0, 5))}
              multiple
              accept=".jpg,.jpeg,.png,.gif,.webp,.bmp,.tiff,.pdf"
              listType="text"
            >
              {fileList.length < 5 && (
                <Button icon={<UploadOutlined />} size="small">
                  Select files (max 5, 10MB each)
                </Button>
              )}
            </Upload>
          </Form.Item>

          {/* Free text message */}
          <Form.Item
            name="message"
            label={<strong>Message</strong>}
            style={{ marginBottom: 8 }}
          >
            <TextArea
              rows={4}
              maxLength={5000}
              showCount
              placeholder="Describe the issue or provide additional context..."
            />
          </Form.Item>

          {/* Optional email */}
          <Form.Item
            name="email"
            label={<strong>Your email (optional)</strong>}
            rules={[{ type: 'email', message: 'Please enter a valid email address' }]}
            style={{ marginBottom: 0 }}
          >
            <Input
              placeholder="you@example.com"
              type="email"
            />
          </Form.Item>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            If provided, we may contact you once your feedback has been reviewed.
          </Typography.Text>
        </Form>
      </Space>
    </Modal>
  )
}
