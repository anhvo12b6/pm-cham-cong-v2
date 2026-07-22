const fs = require('fs');

const path = 'd:\\CongViec\\pm-cham-cong-v2\\Client\\src\\App.css';
let content = fs.readFileSync(path, 'utf8');

// Find the index of .ticks
const ticksIndex = content.indexOf('.ticks {');

if (ticksIndex !== -1) {
  // Keep everything before .ticks
  content = content.substring(0, ticksIndex);
  
  // Append the correct .ticks and reveal buttons CSS
  content += `.ticks {
  position: relative;
  width: 100%;

  &::before,
  &::after {
    content: '';
    position: absolute;
    top: -4.5px;
    border: 5px solid transparent;
  }

  &::before {
    left: 0;
    border-left-color: var(--border);
  }
  &::after {
    right: 0;
    border-right-color: var(--border);
  }
}

/* Reveal Actions Button Container */
.reveal-btn-container {
  position: relative;
  display: inline-flex;
  flex-direction: column;
  border-radius: 6px;
  background-color: #1b7e3e;
  color: white;
  min-width: 170px;
  cursor: default;
  transition: border-radius 0.3s ease;
  z-index: 10;
}

.reveal-btn-container.thaco {
  background-color: #00529C;
}

.reveal-btn-main {
  padding: 8px 16px;
  font-weight: 600;
  text-align: center;
  z-index: 2;
  background: inherit;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 38px;
  cursor: pointer;
}

.reveal-btn-container:hover {
  border-radius: 6px 6px 0 0;
}
.reveal-btn-container:hover .reveal-btn-main {
  border-radius: 6px 6px 0 0;
}

.reveal-actions-panel {
  position: absolute;
  top: 100%;
  left: 0;
  width: 100%;
  background-color: inherit;
  border-radius: 0 0 6px 6px;
  overflow: hidden;
  
  /* Animation cuộn xuống (scroll down) */
  max-height: 0;
  opacity: 0;
  transition: max-height 0.35s ease-in-out, opacity 0.25s ease-in-out;
  box-shadow: 0px 8px 16px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  z-index: 1;
}

.reveal-btn-container:hover .reveal-actions-panel {
  max-height: 120px;
  opacity: 1;
}

.reveal-action-item {
  background: rgba(0, 0, 0, 0.15);
  color: white;
  border: none;
  border-top: 1px solid rgba(255, 255, 255, 0.2);
  padding: 10px 12px;
  font-size: 13px;
  cursor: pointer;
  text-align: center;
  transition: background 0.2s;
  width: 100%;
}

.reveal-action-item:hover {
  background: rgba(0, 0, 0, 0.25);
}
`;

  fs.writeFileSync(path, content, 'utf8');
  console.log('App.css fixed successfully!');
} else {
  console.log('.ticks not found');
}
