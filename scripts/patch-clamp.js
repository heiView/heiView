const fs = require('fs');

let file = fs.readFileSync('src/App.tsx', 'utf8');

const targetTitle = `<span className="hei-event-title">{resolveLocalizedText(event.name, language)}</span>`;
const newTitle = `<span className="hei-event-title" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', whiteSpace: 'normal' }}>{resolveLocalizedText(event.name, language)}</span>`;

const targetMeta = `<span className="hei-event-meta">{resolveLocalizedText(event.prof, language) || '—'}</span>`;
const newMeta = `<span className="hei-event-meta" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', whiteSpace: 'normal' }}>{resolveLocalizedText(event.prof, language) || '—'}</span>`;

const targetNote = `<div style={{ marginTop: 8, fontSize: 12, opacity: 0.8, whiteSpace: 'pre-wrap' }}>`;
const newNote = `<div style={{ marginTop: 8, fontSize: 12, opacity: 0.8, whiteSpace: 'normal', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>`;

if(file.includes(targetTitle)) file = file.replace(targetTitle, newTitle);
if(file.includes(targetMeta)) file = file.replace(targetMeta, newMeta);
if(file.includes(targetNote)) file = file.replace(targetNote, newNote);

fs.writeFileSync('src/App.tsx', file, 'utf8');
console.log('patched');
