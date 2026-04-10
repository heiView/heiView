const fs = require('fs');
const path = require('path');

const appFile = path.join(__dirname, 'src/App.tsx');
let app = fs.readFileSync(appFile, 'utf8');

// 1. Add refs and handlers
app = app.replace(
  `  const initializedRef = React.useRef(false)\n  const campusSyncedRef = React.useRef(false)`,
  `  const initializedRef = React.useRef(false)
  const campusSyncedRef = React.useRef(false)
  const headerScrollRef = React.useRef<HTMLDivElement>(null)
  const bodyScrollRef = React.useRef<HTMLDivElement>(null)

  const handleHeaderScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (bodyScrollRef.current && bodyScrollRef.current.scrollLeft !== (e.target as HTMLDivElement).scrollLeft) {
      bodyScrollRef.current.scrollLeft = (e.target as HTMLDivElement).scrollLeft;
    }
  }

  const handleBodyScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (headerScrollRef.current && headerScrollRef.current.scrollLeft !== (e.target as HTMLDivElement).scrollLeft) {
      headerScrollRef.current.scrollLeft = (e.target as HTMLDivElement).scrollLeft;
    }
  }`
);

// 2. Add header DOM before board frame
const beforeHeader = `            <div className="hei-board-controls-divider" />

            {(!loading && activeBuildingId !== 'No Information' && visibleRoomGroups.length > 0) && (
              <div
                className="hei-board-frame-header"
                ref={headerScrollRef}
                onScroll={handleHeaderScroll}
              >
                <div
                  className="hei-timetable"
                  aria-hidden="true"
                  style={{ width: \`max(100%, \${timelineMinWidth}px)\`, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, minHeight: 'auto' }}
                >
                  <div className="hei-timetable-head" style={{ borderTopLeftRadius: '20px', borderTopRightRadius: '20px' }}>
                    <div className="hei-timetable-head-label" />
                    <div className="hei-timetable-head-track">
                      {Array.from({ length: TRACK_END_HOUR - TRACK_START_HOUR + 1 }, (_, index) => TRACK_START_HOUR + index).map((hour) => {
                        if (hour > 22) return null
                        const left = (hour - TRACK_START_HOUR) * 60 * PIXELS_PER_MINUTE
                        return (
                          <div key={hour} className="hei-hour-label" style={{ left }}>
                            {String(hour).padStart(2, '0')}:00
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div 
              className="hei-board-frame"
              ref={bodyScrollRef}
              onScroll={handleBodyScroll}
            >`;

app = app.replace(
  `            <div className="hei-board-controls-divider" />\n\n            <div className="hei-board-frame">`,
  beforeHeader
);

// 3. Remove header from inside body
const headToRemove = `                  <div className="hei-timetable-head">
                    <div className="hei-timetable-head-label" />
                    <div className="hei-timetable-head-track">
                      {Array.from({ length: TRACK_END_HOUR - TRACK_START_HOUR + 1 }, (_, index) => TRACK_START_HOUR + index).map((hour) => {
                        if (hour > 22) return null
                        const left = (hour - TRACK_START_HOUR) * 60 * PIXELS_PER_MINUTE
                        return (
                          <div key={hour} className="hei-hour-label" style={{ left }}>
                            {String(hour).padStart(2, '0')}:00
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  <div className="hei-timetable-body">`;

app = app.replace(
  `                <div
                  className="hei-timetable"
                  role="table"
                  aria-label={text.boardTitle}
                  style={{ width: \`max(100%, \${timelineMinWidth}px)\` }}
                >\n${headToRemove}`,
  `                <div
                  className="hei-timetable"
                  role="table"
                  aria-label={text.boardTitle}
                  style={{ width: \`max(100%, \${timelineMinWidth}px)\`, borderTopLeftRadius: 0, borderTopRightRadius: 0 }}
                >\n                  <div className="hei-timetable-body">`
);

fs.writeFileSync(appFile, app);

const cssFile = path.join(__dirname, 'src/styles.css');
let css = fs.readFileSync(cssFile, 'utf8');

// Insert new header styles
css = css.replace('.hei-board-frame {', `.hei-board-frame-header {
  position: sticky;
  top: 76px;
  z-index: 20;
  overflow-x: auto;
  overflow-y: hidden;
  width: 100%;
  border-top-left-radius: 20px;
  border-top-right-radius: 20px;
  scrollbar-width: none;
  -ms-overflow-style: none;
  scrollbar-gutter: stable;
}
.hei-board-frame-header::-webkit-scrollbar {
  display: none;
}

.hei-board-frame {`);

// Add scrollbar-gutter to frame
css = css.replace('.hei-board-frame {\n  position: relative;\n  min-height: 380px;\n  max-height: calc(100vh - 240px); /* Constrain height to enable inner scrolling */\n  overflow: auto; /* Allow scrolling in both directions */\n  overscroll-behavior-y: auto; /* Changed from contain to let mobile users scroll the whole page at boundaries */\n}', `.hei-board-frame {\n  position: relative;\n  min-height: 380px;\n  max-height: calc(100vh - 240px);\n  overflow: auto;\n  scrollbar-gutter: stable;\n}`);

// Removing sticky from regular head
css = css.replace(/\.hei-timetable-head \{\n  display: flex;\n  align-items: center;\n  position: sticky;\n  top: 0;/g, `.hei-timetable-head {\n  display: flex;\n  align-items: center;`);

css = css.replace(/\s*\.hei-timetable-head \{\s*top: 136px;\s*\}/g, '');
css = css.replace(/\s*\.hei-timetable-head \{\s*top: 148px;\s*\}/g, '');

// Append correct media query overrides
css = css.replace(/@media \(max-width: 992px\) \{/, `@media (max-width: 992px) {
  .hei-board-frame-header {
    top: 136px;
  }
  
  .hei-board-frame {
    max-height: none !important;
    overflow-y: visible !important;
    overflow-x: auto !important;
  }`);

css = css.replace(/@media \(max-width: 640px\) \{[\s\S]*?\.hei-content \{[\s\S]*?\}/, match => {
  return match + `\n\n  .hei-board-frame-header {\n    top: 148px;\n  }`;
});

fs.writeFileSync(cssFile, css);
