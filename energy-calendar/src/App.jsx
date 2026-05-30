import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Calendar, momentLocalizer } from 'react-big-calendar';
import { DndProvider, useDrag, useDragLayer, useDrop } from 'react-dnd';
import { HTML5Backend, getEmptyImage } from 'react-dnd-html5-backend';
import moment from 'moment';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import './App.css';

const localizer = momentLocalizer(moment);
const EVENT_TYPE = 'CALENDAR_EVENT';

// ── 颜色 ──
const COLORS = {
  1: { bg: '#4CAF50', text: '#fff' },
  2: { bg: '#FFC107', text: '#000' },
  3: { bg: '#F44336', text: '#fff' },
};

// ── 重叠计算 ──
function calcOverlap(events, targetStart, targetEnd, excludeId) {
  const t0 = new Date(targetStart).getTime();
  const t1 = new Date(targetEnd).getTime();
  const points = [];
  for (const e of events) {
    if (e.id === excludeId) continue;
    const s = new Date(e.start).getTime();
    const en = new Date(e.end).getTime();
    if (s < t1 && en > t0) {
      points.push({ t: Math.max(s, t0), d: 1 });
      points.push({ t: Math.min(en, t1), d: -1 });
    }
  }
  if (points.length === 0) return 1;
  points.sort((a, b) => a.t - b.t || a.d - b.d);
  let cur = 0, max = 0;
  for (const p of points) {
    cur += p.d;
    max = Math.max(max, cur);
  }
  return max + 1;
}

// ── 坐标 → 日期 ──
function getDateFromPoint(x, y) {
  // 方案1: bounding box 遍历 .rbc-day-bg
  const allBgs = document.querySelectorAll('.rbc-month-view .rbc-day-bg');
  for (const bg of allBgs) {
    const rect = bg.getBoundingClientRect();
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      const monthRow = bg.closest('.rbc-month-row');
      if (!monthRow) continue;
      const rowBg = bg.parentElement;
      const dayBgs = [...rowBg.querySelectorAll(':scope > .rbc-day-bg')];
      const idx = dayBgs.indexOf(bg);
      if (idx < 0) continue;
      const dateCells = monthRow.querySelectorAll('.rbc-date-cell');
      if (idx >= dateCells.length) continue;
      const cell = dateCells[idx];
      const link = cell.querySelector('.rbc-button-link, a, button');
      const label = link?.getAttribute('aria-label') || link?.textContent?.trim();
      if (label) {
        const d = moment(label, [
          'dddd, MMMM D, YYYY', 'dddd, MMMM DD, YYYY',
          'MMM D, YYYY', 'MMM DD, YYYY',
          'ddd MMM D YYYY', 'ddd, MMM D, YYYY',
          'YYYY年M月D日', 'YYYY年MM月DD日',
          'M月D日', 'MM月DD日',
          'D', 'DD',
        ]).toDate();
        if (!isNaN(d.getTime())) return d;
      }
    }
  }

  // 方案2: elementsFromPoint 直接找 date-cell 内容
  const els = document.elementsFromPoint(x, y);
  for (const el of els) {
    const cell = el.closest?.('.rbc-date-cell');
    if (!cell) continue;
    const link = cell.querySelector('.rbc-button-link, a, button');
    const label = link?.getAttribute('aria-label') || link?.textContent?.trim();
    if (label) {
      const d = moment(label, ['YYYY年M月D日', 'M月D日', 'D']).toDate();
      if (!isNaN(d.getTime())) {
        // 如果只有日数，补全年月
        const num = parseInt(label);
        if (!isNaN(num) && num <= 31) {
          // 取当前月的同一天
          const ref = new Date(2026, 4, 1);
          return new Date(2026, 4, num);
        }
        return d;
      }
    }
  }

  return null;
}

// ═══ 浮动预览 ═══
function DragPreview() {
  const { isDragging, item, offset } = useDragLayer(monitor => ({
    item: monitor.getItem(),
    offset: monitor.getClientOffset(),
    isDragging: monitor.isDragging(),
  }));
  if (!isDragging || !offset || !item?.event) return null;
  return (
    <div style={{ position: 'fixed', left: 0, top: 0, pointerEvents: 'none', zIndex: 9999,
      transform: `translate(${offset.x - 70}px, ${offset.y - 14}px)` }}>
      <div style={{
        background: COLORS[Math.min(item.level || 1, 3)].bg,
        color: '#fff', padding: '6px 16px', borderRadius: '6px',
        fontSize: '13px', fontWeight: 600,
        boxShadow: '0 10px 40px rgba(0,0,0,0.35)', opacity: 0.95, whiteSpace: 'nowrap',
      }}>{item.event.title}</div>
    </div>
  );
}

// ═══ 拖拽包裹层（cloneElement 不增DOM）═══
function DragEventWrapper({ event, children }) {
  const [{ isDragging }, drag, preview] = useDrag(() => ({
    type: EVENT_TYPE,
    item: () => ({ event, level: 1 }),
    collect: m => ({ isDragging: m.isDragging() }),
  }), [event]);

  useEffect(() => {
    preview(getEmptyImage(), { captureDraggingState: true });
  }, [preview]);

  if (!children) return null;

  // 不增加多余 DOM，直接把 drag ref 挂到 RBC 渲染的事件元素上
  return React.cloneElement(children, {
    ref: (node) => {
      // 保留 RBC 原有的 ref（如果有）
      if (typeof children.ref === 'function') children.ref(node);
      drag(node);
    },
    style: {
      ...children.props?.style,
      opacity: isDragging ? 0.25 : 1,
      cursor: 'grab',
      transition: 'opacity 0.15s',
    },
  });
}

// ═══ 放置层 ═══
function DropTarget({ children, onDrop }) {
  const [, drop] = useDrop(() => ({
    accept: EVENT_TYPE,
    drop: (item, monitor) => {
      const off = monitor.getClientOffset();
      if (off && onDrop) onDrop(item, off.x, off.y);
    },
  }), [onDrop]);
  return <div ref={drop} style={{ height: '100%' }}>{children}</div>;
}

// ── 数据 ──
const D = (d, h = 0, m = 0) => new Date(2026, 4, d, h, m);
const INITIAL_EVENTS = [
  { id: 1,  title: 'Q2 战略研讨会',     start: D(25, 9, 0),  end: D(27, 18, 0) },
  { id: 2,  title: '产品 Hackathon',    start: D(26, 8, 0),  end: D(28, 17, 0) },
  { id: 3,  title: '深度工作',           start: D(25, 9, 0),  end: D(25, 11, 0) },
  { id: 4,  title: '客户沟通',           start: D(25, 14, 0),  end: D(25, 15, 30) },
  { id: 5,  title: '周会',              start: D(26, 9, 0),  end: D(26, 10, 0) },
  { id: 6,  title: '代码评审',           start: D(26, 9, 30), end: D(26, 11, 0) },
  { id: 7,  title: '用户调研',           start: D(27, 8, 0),  end: D(27, 10, 0) },
  { id: 8,  title: '竞品分析',           start: D(27, 9, 0),  end: D(27, 11, 0) },
  { id: 9,  title: '站会',              start: D(27, 10, 0), end: D(27, 10, 30) },
  { id: 10, title: '技术分享',           start: D(28, 10, 0), end: D(28, 11, 30) },
  { id: 11, title: '需求梳理',           start: D(28, 14, 0), end: D(28, 16, 0) },
  { id: 12, title: 'Sprint 规划',      start: D(29, 9, 0),  end: D(29, 11, 0) },
  { id: 13, title: '回顾会议',           start: D(29, 10, 0), end: D(29, 12, 0) },
];

const MAX_HISTORY = 30;

export default function App() {
  const [events, setEvents] = useState(INITIAL_EVENTS);
  const [history, setHistory] = useState([INITIAL_EVENTS]);

  const undo = useCallback(() => {
    setHistory(prev => {
      if (prev.length <= 1) return prev;
      const next = prev.slice(0, -1);
      setEvents(next[next.length - 1]);
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.target.closest('input,textarea')) {
        e.preventDefault(); undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo]);

  const pushHistory = useCallback((n) => {
    setHistory(prev => [...prev.slice(-(MAX_HISTORY - 1)), n]);
  }, []);

  const applyMove = useCallback((ev, start, end) => {
    setEvents(prev => {
      const next = prev.map(e => e.id === ev.id ? { ...e, start, end } : e);
      pushHistory(next);
      return next;
    });
  }, [pushHistory]);

  const handleDrop = useCallback((item, x, y) => {
    const targetDate = getDateFromPoint(x, y);
    if (!targetDate) return;
    const ev = item.event;
    const dur = new Date(ev.end).getTime() - new Date(ev.start).getTime();
    const ns = moment(targetDate).hour(ev.start.getHours()).minute(ev.start.getMinutes()).second(0).toDate();
    const ne = new Date(ns.getTime() + dur);
    applyMove(ev, ns, ne);
  }, [events, applyMove]);

  const eventPropGetter = useCallback((event, start, end) => {
    const lv = calcOverlap(events, start, end, event.id);
    const c = COLORS[Math.min(lv, 3)];
    return { style: { backgroundColor: c.bg, color: c.text, border: 'none', borderRadius: '3px', opacity: 0.92 } };
  }, [events]);

  return (
    <DndProvider backend={HTML5Backend}>
      <DragPreview />
      <div className="app-container">
        <div className="header">
          <h2>⚡ 精力感知日历</h2>
          <button className="undo-btn" onClick={undo} disabled={history.length <= 1}>↩ 撤销 (Ctrl+Z)</button>
        </div>
        <div className="legend">
          <span className="legend-item"><span className="dot" style={{ background: '#4CAF50' }} /> 低压力</span>
          <span className="legend-item"><span className="dot" style={{ background: '#FFC107' }} /> 中压力</span>
          <span className="legend-item"><span className="dot" style={{ background: '#F44336' }} /> 高压力</span>
        </div>
        <div className="calendar-wrapper">
          <DropTarget onDrop={handleDrop}>
            <Calendar
              localizer={localizer}
              events={events}
              defaultView="month"
              defaultDate={new Date(2026, 4, 25)}
              eventPropGetter={eventPropGetter}
              components={{ eventWrapper: DragEventWrapper }}
              popup
              views={['month', 'week', 'day']}
            />
          </DropTarget>
        </div>
      </div>
    </DndProvider>
  );
}
