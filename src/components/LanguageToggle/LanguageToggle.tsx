import React from 'react'
import { Segmented } from 'antd'
import useStore, { Language } from '../../store'

type LanguageOption = {
  value: Language;
  code: string;
  names: Record<Language, string>;
};

const OPTIONS: LanguageOption[] = [
  { value: 'en', code: 'EN', names: { en: 'English', zh: '英文', de: 'Englisch' } },
  { value: 'zh', code: 'ZH', names: { en: 'Chinese', zh: '中文', de: 'Chinesisch' } },
  { value: 'de', code: 'DE', names: { en: 'German', zh: '德语', de: 'Deutsch' } },
];

function LanguageToggle({ className }: { className?: string }) {
  const language = useStore((state) => state.language)
  const setLanguage = useStore((state) => state.setLanguage)

  return (
    <Segmented
      className={className}
      value={language}
      onChange={(value) => setLanguage(value as Language)}
      options={OPTIONS.map((option) => ({
        value: option.value,
        label: <span>{option.code}</span>,
      }))}
    />
  )
}

export default LanguageToggle
