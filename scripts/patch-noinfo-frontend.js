const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const targetStr = `              ) : visibleRoomGroups.length > 0 ? (
                <div
                  className="hei-timetable"`;

const newStr = `              ) : activeBuildingId === 'No Information' ? (
                <div className="hei-no-info-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px', padding: '16px' }}>
                  {(() => {
                    const allCourses = visibleRoomGroups.flatMap(g => g.rooms.flatMap(r => getVisibleRoomCourses(r, search.trim().toLowerCase(), language)));
                    return allCourses.map((event, idx) => (
                      <div
                        key={idx}
                        className="hei-event"
                        style={{ position: 'relative', width: '100%', height: 'auto', padding: '12px', minHeight: '120px', cursor: 'pointer' }}
                        onClick={() => setSelectedCourse({ room: 'No Information', course: event, startMinutes: 0, endMinutes: 0 })}
                      >
                        <span className="hei-event-title">{resolveLocalizedText(event.name, language)}</span>
                        <span className="hei-event-meta">{resolveLocalizedText(event.prof, language) || '—'}</span>
                        {event.note && (
                          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8, whiteSpace: 'pre-wrap' }}>
                             {event.note.slice(0, 100)}{event.note.length > 100 ? '...' : ''}
                          </div>
                        )}
                      </div>
                    ));
                  })()}
                </div>
              ) : visibleRoomGroups.length > 0 ? (
                <div
                  className="hei-timetable"`;

if (code.includes(targetStr)) {
  fs.writeFileSync('src/App.tsx', code.replace(targetStr, newStr), 'utf8');
  console.log("Patched App.tsx successfully.");
} else {
  console.log("Could not find target in App.tsx!");
}
