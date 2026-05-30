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
          'M月D日', 'MM月DD日', 'D', 'DD',
        ]).toDate();
        if (!isNaN(d.getTime())) return d;
      }
    }
  }
  const els = document.elementsFromPoint(x, y);
  for (const el of els) {
    const cell = el.closest?.('.rbc-date-cell');
    if (!cell) continue;
    const link = cell.querySelector('.rbc-button-link, a, button');
    const label = link?.getAttribute('aria-label') || link?.textContent?.trim();
    if (label) {
      const num = parseInt(label);
      if (!isNaN(num) && num <= 31) return new Date(2026, 4, num);
      const d = moment(label, ['YYYY年M月D日', 'M月D日', 'D']).toDate();
      if (!isNaN(d.getTime())) return d;
    }
  }
  return null;
}

// ═══ 浮动预览（仅移动模式）═══
function DragPreview() {
  const { isDragging, item, offset } = useDragLayer(monitor => ({
    item: monitor.getItem(),
    offset: monitor.getClientOffset(),
    isDragging: monitor.isDragging(),
  }));
  if (!isDragging || !offset || !item?.event) return null;
  if (item.mode !== 'move') return null;

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

// ═══ 拉伸幽灵 ═══
function GhostMonitor({ onGhost }) {
  const { isDragging, item, offset } = useDragLayer(monitor => ({
    item: monitor.getItem(),
    offset: monitor.getClientOffset(),
    isDragging: monitor.isDragging(),
  }));
  useEffect(() => {
    if (isDragging && item?.mode?.startsWith('resize') && offset && item.event) {
      const td = getDateFromPoint(offset.x, offset.y);
      if (!td) return;
      const ev = item.event;
      if (item.mode === 'resizeLeft') {
        const ns = moment(td).hour(ev.start.getHours()).minute(ev.start.getMinutes()).toDate();
        if (ns < new Date(ev.end)) onGhost({ ...ev, start: ns, __ghost: true });
      } else if (item.mode === 'resizeRight') {
        const ne = moment(td).add(1, 'day').hour(ev.end.getHours()).minute(ev.end.getMinutes()).toDate();
        if (ne > new Date(ev.start)) onGhost({ ...ev, end: ne, __ghost: true });
      }
    } else if (!isDragging) {
      onGhost(null);
    }
  }, [isDragging, item, offset, onGhost]);
  return null;
}

// ═══ 事件包裹层（边缘检测 + 右键删除）═══
function DragEventWrapper({ event, children, onDelete }) {
  const modeRef = useRef('move');
  const [edge, setEdge] = useState(null);

  const handleMouseMove = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const zone = Math.min(rect.width * 0.2, 18);
    if (x < zone) setEdge('left');
    else if (x > rect.width - zone) setEdge('right');
    else setEdge(null);
  }, []);

  const handleMouseDown = useCallback((e) => {
    if (e.button === 2) return; // 右键不处理拖拽
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const zone = Math.min(rect.width * 0.2, 18);
    if (x < zone) modeRef.current = 'resizeLeft';
    else if (x > rect.width - zone) modeRef.current = 'resizeRight';
    else modeRef.current = 'move';
  }, []);

  const handleContextMenu = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (onDelete) onDelete(event);
  }, [event, onDelete]);

  const handleMouseLeave = useCallback(() => setEdge(null), []);

  const [{ isDragging }, drag, preview] = useDrag(() => ({
    type: EVENT_TYPE,
    item: () => ({ event, mode: modeRef.current, level: 1 }),
    collect: m => ({ isDragging: m.isDragging() }),
  }), [event]);

  useEffect(() => { preview(getEmptyImage(), { captureDraggingState: true }); }, [preview]);
  if (!children) return null;

  const cursor = edge === 'left' ? 'w-resize' : edge === 'right' ? 'e-resize' : 'grab';

  return React.cloneElement(children, {
    ref: (node) => { if (typeof children.ref === 'function') children.ref(node); drag(node); },
    onMouseDown: handleMouseDown,
    onMouseMove: handleMouseMove,
    onMouseLeave: handleMouseLeave,
    onContextMenu: handleContextMenu,
    'data-edge': edge || undefined,
    style: { ...children.props?.style, opacity: isDragging ? 0.25 : 1, cursor, transition: 'opacity 0.15s' },
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

// ═══ 添加任务弹窗 ═══
function AddTaskModal({ defaultDate, onAdd, onClose }) {
  const today = new Date();
  const [title, setTitle] = useState('');
  const [month, setMonth] = useState(defaultDate ? defaultDate.getMonth() + 1 : today.getMonth() + 1);
  const [day, setDay]     = useState(defaultDate ? defaultDate.getDate()     : today.getDate());
  const [hour, setHour]   = useState(9);
  const [minute, setMin]  = useState(0);

  const handleSubmit = () => {
    const y = defaultDate ? defaultDate.getFullYear() : today.getFullYear();
    const start = new Date(y, month - 1, day, hour, minute);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    if (isNaN(start.getTime())) return;
    onAdd({ title: title || '新任务', start, end });
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal event-modal" onClick={e => e.stopPropagation()}>
        <h3>添加任务</h3>

        <label>任务名称</label>
        <input className="modal-input" value={title} onChange={e => setTitle(e.target.value)}
          placeholder="输入任务名称" autoFocus onKeyDown={e => e.key === 'Enter' && handleSubmit()} />

        <label>日期</label>
        <div className="modal-date-row">
          <input type="number" className="modal-input modal-num" value={month} onChange={e => setMonth(Number(e.target.value))}
            min={1} max={12} placeholder="月" />
          <span className="modal-date-label">月</span>
          <input type="number" className="modal-input modal-num" value={day} onChange={e => setDay(Number(e.target.value))}
            min={1} max={31} placeholder="日" />
          <span className="modal-date-label">日</span>
        </div>

        <label>时间</label>
        <div className="modal-date-row">
          <input type="number" className="modal-input modal-num" value={hour} onChange={e => setHour(Number(e.target.value))}
            min={0} max={23} placeholder="时" />
          <span className="modal-date-label">:</span>
          <input type="number" className="modal-input modal-num" value={minute} onChange={e => setMin(Number(e.target.value))}
            min={0} max={59} placeholder="分" />
        </div>

        <div className="modal-buttons">
          <button className="btn-cancel" onClick={onClose}>取消</button>
          <button className="btn-confirm" onClick={handleSubmit}>添加</button>
        </div>
      </div>
    </div>
  );
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
  const [ghost, setGhost] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const nextIdRef = useRef(14);

  // 幽灵事件合并
  const displayEvents = ghost
    ? [...events.filter(e => e.id !== ghost.id), ghost]
    : events;

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

  const addEvent = useCallback((data) => {
    const newEvent = { ...data, id: nextIdRef.current++ };
    setEvents(prev => { const next = [...prev, newEvent]; pushHistory(next); return next; });
  }, [pushHistory]);

  const handleDrop = useCallback((item, x, y) => {
    setGhost(null);
    const targetDate = getDateFromPoint(x, y);
    if (!targetDate) return;
    const ev = item.event;

    if (item.mode === 'resizeLeft') {
      const ns = moment(targetDate).hour(ev.start.getHours()).minute(ev.start.getMinutes()).second(0).toDate();
      if (ns >= new Date(ev.end)) return;
      applyMove(ev, ns, new Date(ev.end));
    } else if (item.mode === 'resizeRight') {
      const ne = moment(targetDate).add(1, 'day').hour(ev.end.getHours()).minute(ev.end.getMinutes()).second(0).toDate();
      if (ne <= new Date(ev.start)) return;
      applyMove(ev, new Date(ev.start), ne);
    } else {
      const dur = new Date(ev.end).getTime() - new Date(ev.start).getTime();
      const ns = moment(targetDate).hour(ev.start.getHours()).minute(ev.start.getMinutes()).second(0).toDate();
      const ne = new Date(ns.getTime() + dur);
      applyMove(ev, ns, ne);
    }
  }, [applyMove]);

  const handleGhost = useCallback((g) => setGhost(g), []);

  // ── 左键空白区：单击创建 / 拖拽跨天（带幽灵预览）──
  const lcRef = useRef({ active: false, startDate: null });
  const [lcGhost, setLcGhost] = useState(null);

  const handleLcMouseDown = useCallback((e) => {
    if (e.button !== 0) return; // 只处理左键
    // 如果点在事件上 → 交给 DragEventWrapper 的 drag
    if (e.target.closest('.rbc-event')) return;
    const d = getDateFromPoint(e.clientX, e.clientY);
    if (!d) return;
    lcRef.current = { active: true, startDate: d, moved: false };
    const end = new Date(d.getTime() + 24 * 60 * 60 * 1000);
    setLcGhost({ id: -1, title: '新任务', start: d, end, __ghost: true });
  }, []);

  const handleLcMouseMove = useCallback((e) => {
    if (!lcRef.current.active) return;
    const d = getDateFromPoint(e.clientX, e.clientY);
    if (!d) return;
    lcRef.current.moved = true;
    const start = lcRef.current.startDate;
    const s = new Date(Math.min(start.getTime(), d.getTime()));
    const eNd = new Date(Math.max(start.getTime(), d.getTime()) + 24 * 60 * 60 * 1000);
    setLcGhost({ id: -1, title: '新任务', start: s, end: eNd, __ghost: true });
  }, []);

  const handleLcMouseUp = useCallback((e) => {
    if (!lcRef.current.active) return;
    lcRef.current.active = false;
    setLcGhost(null);
    const d = getDateFromPoint(e.clientX, e.clientY);
    if (!d) return;
    const start = lcRef.current.startDate;
    if (lcRef.current.moved) {
      // 拖拽 → 跨天任务 9:00-18:00
      const s = new Date(Math.min(start.getTime(), d.getTime()));
      const eNd = new Date(Math.max(start.getTime(), d.getTime()) + 24 * 60 * 60 * 1000);
      s.setHours(9, 0, 0, 0);
      eNd.setHours(18, 0, 0, 0);
      addEvent({ title: '新任务', start: s, end: eNd });
    } else {
      // 单击 → 1 小时任务 9:00-10:00
      const s = new Date(start);
      s.setHours(9, 0, 0, 0);
      const eNd = new Date(s.getTime() + 60 * 60 * 1000);
      addEvent({ title: '新任务', start: s, end: eNd });
    }
  }, [addEvent]);

  // 合并左键幽灵到显示列表
  const allDisplayEvents = lcGhost
    ? [...displayEvents.filter(e => e.id !== -1), lcGhost]
    : displayEvents;

  // ── 右键事件 → 删除 ──
  const handleDelete = useCallback((event) => {
    setEvents(prev => {
      const next = prev.filter(e => e.id !== event.id);
      pushHistory(next);
      return next;
    });
  }, [pushHistory]);

  const eventPropGetter = useCallback((event) => {
    if (event.__ghost) {
      return {
        style: {
          backgroundColor: 'rgba(92, 107, 192, 0.35)',
          color: '#1a1a2e',
          border: '2px solid #5C6BC0',
          borderRadius: '3px',
          opacity: 1,
          fontWeight: 600,
        },
        className: 'rbc-event-ghost',
      };
    }
    const lv = calcOverlap(events, event.start, event.end, event.id);
    const c = COLORS[Math.min(lv, 3)];
    return { style: { backgroundColor: c.bg, color: c.text, border: 'none', borderRadius: '3px', opacity: 0.92 } };
  }, [events]);

  return (
    <DndProvider backend={HTML5Backend}>
      <DragPreview />
      <GhostMonitor onGhost={handleGhost} />
      <div className="app-container"
        onMouseDown={handleLcMouseDown}
        onMouseMove={handleLcMouseMove}
        onMouseUp={handleLcMouseUp}
      >
        <div className="header">
          <h2>⚡ 精力感知日历</h2>
          <div className="header-btns">
            <button className="add-btn" onClick={() => setShowAddModal(true)}>＋ 添加任务</button>
            <button className="undo-btn" onClick={undo} disabled={history.length <= 1}>↩ 撤销</button>
          </div>
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
              events={allDisplayEvents}
              defaultView="month"
              defaultDate={new Date(2026, 4, 25)}
              eventPropGetter={eventPropGetter}
              components={{ eventWrapper: (props) => <DragEventWrapper {...props} onDelete={handleDelete} /> }}
              popup
              views={['month', 'week', 'day']}
            />
          </DropTarget>
        </div>

        {showAddModal && (
          <AddTaskModal
            defaultDate={new Date(2026, 4, 25)}
            onAdd={addEvent}
            onClose={() => setShowAddModal(false)}
          />
        )}
      </div>
    </DndProvider>
  );
}
