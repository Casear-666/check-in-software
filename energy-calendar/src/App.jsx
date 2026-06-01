import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Calendar, momentLocalizer } from 'react-big-calendar';
import { DndProvider, useDrag, useDragLayer, useDrop } from 'react-dnd';
import { HTML5Backend, getEmptyImage } from 'react-dnd-html5-backend';
import moment from 'moment';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import './App.css';
import { colorForOverlap, eventGradient } from './colors';
import { fetchTasks, createTask, updateTask, deleteTask, debouncedUpdateTime } from './api';

const localizer = momentLocalizer(moment);
const EVENT_TYPE = 'CALENDAR_EVENT';

// ── 重叠计算（扫线算法 O(n log n)）──
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

  const c = colorForOverlap(item.level || 1);

  return (
    <div style={{ position: 'fixed', left: 0, top: 0, pointerEvents: 'none', zIndex: 9999,
      transform: `translate(${offset.x - 70}px, ${offset.y - 14}px)` }}>
      <div style={{
        backgroundColor: c.bg, color: c.text, padding: '6px 16px', borderRadius: '6px',
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
function DragEventWrapper({ event, children, onDelete, overlapLevel }) {
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
    if (e.button === 2) return;
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
    item: () => ({ event, mode: modeRef.current, level: overlapLevel || 1 }),
    collect: m => ({ isDragging: m.isDragging() }),
  }), [event, overlapLevel]);

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

// ═══ 任务弹窗（新建 + 编辑共用）═══
function EventModal({ event, defaultDate, onSave, onDelete, onClose }) {
  const isEdit = !!event;
  const today = new Date();

  const getFields = () => {
    if (event) {
      return {
        title: event.title,
        desc: event.description || '',
        sM: event.start.getMonth() + 1, sD: event.start.getDate(),
        sH: event.start.getHours(), sMin: event.start.getMinutes(),
        eM: event.end.getMonth() + 1, eD: event.end.getDate(),
        eH: event.end.getHours(), eMin: event.end.getMinutes(),
      };
    }
    return {
      title: '',
      desc: '',
      sM: defaultDate ? defaultDate.getMonth() + 1 : today.getMonth() + 1,
      sD: defaultDate ? defaultDate.getDate() : today.getDate(),
      sH: 9, sMin: 0,
      eM: defaultDate ? defaultDate.getMonth() + 1 : today.getMonth() + 1,
      eD: defaultDate ? defaultDate.getDate() : today.getDate(),
      eH: 10, eMin: 0,
    };
  };

  const init = getFields();
  const [title, setTitle] = useState(init.title);
  const [desc, setDesc] = useState(init.desc);
  const [sM, setSM] = useState(init.sM); const [sD, setSD] = useState(init.sD);
  const [sH, setSH] = useState(init.sH); const [sMin, setSMin] = useState(init.sMin);
  const [eM, setEM] = useState(init.eM); const [eD, setED] = useState(init.eD);
  const [eH, setEH] = useState(init.eH); const [eMin, setEMin] = useState(init.eMin);

  const year = event ? event.start.getFullYear() : (defaultDate ? defaultDate.getFullYear() : today.getFullYear());

  const buildDates = () => {
    const start = new Date(year, sM - 1, sD, sH, sMin);
    const end = new Date(year, eM - 1, eD, eH, eMin);
    return { start, end };
  };

  const handleSubmit = () => {
    const { start, end } = buildDates();
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return;
    if (end <= start) return;
    onSave({
      ...(isEdit ? { id: event.id } : {}),
      title: title || '新任务',
      start,
      end,
      description: desc,
    });
    onClose();
  };

  const handleDelete = () => {
    if (isEdit && onDelete) onDelete(event.id);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal event-modal" onClick={e => e.stopPropagation()}>
        <h3>{isEdit ? '编辑任务' : '添加任务'}</h3>

        <label>任务名称</label>
        <input className="modal-input" value={title} onChange={e => setTitle(e.target.value)}
          placeholder="输入任务名称" autoFocus onKeyDown={e => e.key === 'Enter' && handleSubmit()} />

        <label>描述</label>
        <textarea className="modal-input modal-textarea" value={desc} onChange={e => setDesc(e.target.value)}
          placeholder="可选描述" rows={2} />

        <label>开始时间</label>
        <div className="modal-date-row">
          <input type="number" className="modal-input modal-num" value={sM} onChange={e => setSM(Number(e.target.value))} min={1} max={12} />
          <span className="modal-date-label">月</span>
          <input type="number" className="modal-input modal-num" value={sD} onChange={e => setSD(Number(e.target.value))} min={1} max={31} />
          <span className="modal-date-label">日</span>
          <input type="number" className="modal-input modal-num" value={sH} onChange={e => setSH(Number(e.target.value))} min={0} max={23} />
          <span className="modal-date-label">:</span>
          <input type="number" className="modal-input modal-num" value={sMin} onChange={e => setSMin(Number(e.target.value))} min={0} max={59} />
        </div>

        <label>结束时间</label>
        <div className="modal-date-row">
          <input type="number" className="modal-input modal-num" value={eM} onChange={e => setEM(Number(e.target.value))} min={1} max={12} />
          <span className="modal-date-label">月</span>
          <input type="number" className="modal-input modal-num" value={eD} onChange={e => setED(Number(e.target.value))} min={1} max={31} />
          <span className="modal-date-label">日</span>
          <input type="number" className="modal-input modal-num" value={eH} onChange={e => setEH(Number(e.target.value))} min={0} max={23} />
          <span className="modal-date-label">:</span>
          <input type="number" className="modal-input modal-num" value={eMin} onChange={e => setEMin(Number(e.target.value))} min={0} max={59} />
        </div>

        <div className="modal-buttons">
          {isEdit && <button className="btn-delete" onClick={handleDelete}>删除</button>}
          <button className="btn-cancel" onClick={onClose}>取消</button>
          <button className="btn-confirm" onClick={handleSubmit}>{isEdit ? '保存' : '添加'}</button>
        </div>
      </div>
    </div>
  );
}

// ── 初始数据 ──
const D = (d, h = 0, m = 0) => new Date(2026, 4, d, h, m);
const INITIAL_EVENTS = [
  { id: 1,  title: 'Q2 战略研讨会',     start: D(25, 9, 0),  end: D(27, 18, 0), description: '' },
  { id: 2,  title: '产品 Hackathon',    start: D(26, 8, 0),  end: D(28, 17, 0), description: '' },
  { id: 3,  title: '深度工作',           start: D(25, 9, 0),  end: D(25, 11, 0), description: '' },
  { id: 4,  title: '客户沟通',           start: D(25, 14, 0),  end: D(25, 15, 30), description: '' },
  { id: 5,  title: '周会',              start: D(26, 9, 0),  end: D(26, 10, 0), description: '' },
  { id: 6,  title: '代码评审',           start: D(26, 9, 30), end: D(26, 11, 0), description: '' },
  { id: 7,  title: '用户调研',           start: D(27, 8, 0),  end: D(27, 10, 0), description: '' },
  { id: 8,  title: '竞品分析',           start: D(27, 9, 0),  end: D(27, 11, 0), description: '' },
  { id: 9,  title: '站会',              start: D(27, 10, 0), end: D(27, 10, 30), description: '' },
  { id: 10, title: '技术分享',           start: D(28, 10, 0), end: D(28, 11, 30), description: '' },
  { id: 11, title: '需求梳理',           start: D(28, 14, 0), end: D(28, 16, 0), description: '' },
  { id: 12, title: 'Sprint 规划',      start: D(29, 9, 0),  end: D(29, 11, 0), description: '' },
  { id: 13, title: '回顾会议',           start: D(29, 10, 0), end: D(29, 12, 0), description: '' },
];

const MAX_HISTORY = 30;

export default function App() {
  const [events, setEvents] = useState(INITIAL_EVENTS);
  const [history, setHistory] = useState([INITIAL_EVENTS]);
  const [ghost, setGhost] = useState(null);
  const [showEventModal, setShowEventModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null); // null=新建, 非null=编辑
  const nextIdRef = useRef(14);

  // ── 启动时从 API 加载数据 ──
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await fetchTasks();
        if (!cancelled && data && data.length > 0) {
          const mapped = data.map(e => ({
            ...e,
            start: new Date(e.start),
            end: new Date(e.end),
            description: e.description || '',
          }));
          setEvents(mapped);
          setHistory([mapped]);
          nextIdRef.current = Math.max(...mapped.map(e => e.id), 0) + 1;
        }
      } catch {
        // API 不可用 → 使用本地初始数据
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // ── 重叠等级缓存 + 展示事件列表 ──
  // 合并为一个 useMemo，避免级联重渲染
  const { displayEvents, overlapMap } = useMemo(() => {
    const display = ghost
      ? [...events.filter(e => e.id !== ghost.id), ghost]
      : events;
    const map = new Map();
    for (const ev of display) {
      map.set(ev.id, calcOverlap(events, ev.start, ev.end, ev.id));
    }
    return { displayEvents: display, overlapMap: map };
  }, [events, ghost]);

  // ── 撤销 ──
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

  // ── 内部状态更新 + 历史 ──
  const applyEvents = useCallback((next, opts = {}) => {
    setEvents(next);
    if (!opts.skipHistory) pushHistory(next);
  }, [pushHistory]);

  // ── CRUD 操作（乐观更新 + API 持久化）──

  const addEvent = useCallback((data) => {
    const newEvent = { ...data, id: nextIdRef.current++, description: data.description || '' };
    setEvents(prev => { const next = [...prev, newEvent]; pushHistory(next); return next; });
    // 异步持久化
    createTask(newEvent).catch(() => {});
  }, [pushHistory]);

  const editEvent = useCallback((id, data) => {
    setEvents(prev => {
      const next = prev.map(e => e.id === id ? { ...e, ...data } : e);
      pushHistory(next);
      return next;
    });
    updateTask(id, data).catch(() => {});
  }, [pushHistory]);

  const removeEvent = useCallback((id) => {
    setEvents(prev => {
      const next = prev.filter(e => e.id !== id);
      pushHistory(next);
      return next;
    });
    deleteTask(id).catch(() => {});
  }, [pushHistory]);

  // ── 拖拽松手 ──
  const handleDrop = useCallback((item, x, y) => {
    setGhost(null);
    const targetDate = getDateFromPoint(x, y);
    if (!targetDate) return;
    const ev = item.event;

    if (item.mode === 'resizeLeft') {
      const ns = moment(targetDate).hour(ev.start.getHours()).minute(ev.start.getMinutes()).second(0).toDate();
      if (ns >= new Date(ev.end)) return;
      setEvents(prev => {
        const next = prev.map(e => e.id === ev.id ? { ...e, start: ns } : e);
        pushHistory(next);
        return next;
      });
      debouncedUpdateTime(ev.id, ns, ev.end);
    } else if (item.mode === 'resizeRight') {
      const ne = moment(targetDate).add(1, 'day').hour(ev.end.getHours()).minute(ev.end.getMinutes()).second(0).toDate();
      if (ne <= new Date(ev.start)) return;
      setEvents(prev => {
        const next = prev.map(e => e.id === ev.id ? { ...e, end: ne } : e);
        pushHistory(next);
        return next;
      });
      debouncedUpdateTime(ev.id, ev.start, ne);
    } else {
      // 移动
      const dur = new Date(ev.end).getTime() - new Date(ev.start).getTime();
      const ns = moment(targetDate).hour(ev.start.getHours()).minute(ev.start.getMinutes()).second(0).toDate();
      const ne = new Date(ns.getTime() + dur);
      setEvents(prev => {
        const next = prev.map(e => e.id === ev.id ? { ...e, start: ns, end: ne } : e);
        pushHistory(next);
        return next;
      });
      debouncedUpdateTime(ev.id, ns, ne);
    }
  }, [pushHistory]);

  const handleGhost = useCallback((g) => setGhost(g), []);

  // ── 右键事件 → 删除 ──
  const handleDelete = useCallback((event) => {
    removeEvent(event.id);
  }, [removeEvent]);

  // ── 双击事件 → 编辑弹窗 ──
  const handleDoubleClick = useCallback((event) => {
    if (event.__ghost) return; // 忽略幽灵事件
    setEditingEvent(event);
    setShowEventModal(true);
  }, []);

  // ── 弹窗保存 ──
  const handleModalSave = useCallback((data) => {
    if (data.id) {
      editEvent(data.id, data);
    } else {
      addEvent(data);
    }
  }, [addEvent, editEvent]);

  const handleModalDelete = useCallback((id) => {
    removeEvent(id);
  }, [removeEvent]);

  // ── 左键空白区：单击创建 / 拖拽跨天（带幽灵预览）──
  const lcRef = useRef({ active: false, startDate: null });
  const [lcGhost, setLcGhost] = useState(null);

  // 全局 mouseup 清理：防止鼠标在窗口外释放导致幽灵残留
  useEffect(() => {
    const onWindowUp = () => {
      if (lcRef.current.active) {
        lcRef.current.active = false;
        setLcGhost(null);
      }
    };
    window.addEventListener('mouseup', onWindowUp);
    return () => window.removeEventListener('mouseup', onWindowUp);
  }, []);

  // 追踪 RBC "+N more" 弹窗状态
  const overlayOpenRef = useRef(false);
  useEffect(() => {
    const check = () => {
      overlayOpenRef.current = !!document.querySelector('.rbc-overlay');
    };
    const interval = setInterval(check, 200);
    // 也用 MutationObserver 监听 overlay 的增删
    const obs = new MutationObserver(() => check());
    obs.observe(document.body, { childList: true, subtree: true });
    return () => { clearInterval(interval); obs.disconnect(); };
  }, []);

  const handleLcMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.rbc-event, .rbc-show-more, .rbc-overlay')) return;
    if (overlayOpenRef.current || document.querySelector('.rbc-overlay')) return;
    const d = getDateFromPoint(e.clientX, e.clientY);
    if (!d) return;
    lcRef.current = { active: true, startDate: d, moved: false };
    const end = new Date(d.getTime() + 24 * 60 * 60 * 1000);
    setLcGhost({ id: -1, title: '新任务', start: d, end, __ghost: true });
  }, []);

  const handleLcMouseMove = useCallback((e) => {
    if (!lcRef.current.active) return;
    if (overlayOpenRef.current || document.querySelector('.rbc-overlay')) {
      lcRef.current.active = false; setLcGhost(null); return;
    }
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
      const s = new Date(Math.min(start.getTime(), d.getTime()));
      const eNd = new Date(Math.max(start.getTime(), d.getTime()) + 24 * 60 * 60 * 1000);
      s.setHours(9, 0, 0, 0);
      eNd.setHours(18, 0, 0, 0);
      addEvent({ title: '新任务', start: s, end: eNd });
    } else {
      const s = new Date(start);
      s.setHours(9, 0, 0, 0);
      const eNd = new Date(s.getTime() + 60 * 60 * 1000);
      addEvent({ title: '新任务', start: s, end: eNd });
    }
  }, [addEvent]);

  // 合并所有展示事件（含左键幽灵）
  const allDisplayEvents = useMemo(() => {
    if (lcGhost) {
      return [...displayEvents.filter(e => e.id !== -1), lcGhost];
    }
    return displayEvents;
  }, [displayEvents, lcGhost]);

  // 为左键幽灵也计算重叠等级供着色用
  const lcGhostOverlap = useMemo(() => {
    if (!lcGhost) return null;
    return calcOverlap(events, lcGhost.start, lcGhost.end, lcGhost.id);
  }, [events, lcGhost]);

  // ── 事件着色 ──
  const eventPropGetter = useCallback((event) => {
    if (event.__ghost) {
      // 幽灵事件：半透明渐变色 + 实色边框
      const lv = event.id === -1 ? (lcGhostOverlap || 1) : (overlapMap.get(event.id) || 1);
      const c = colorForOverlap(lv);
      return {
        style: {
          backgroundColor: `hsla(${c.h},${c.s}%,${c.l}%,0.35)`,
          color: c.text,
          border: `2px solid ${c.bg}`,
          borderRadius: '5px',
          opacity: 1,
          fontWeight: 600,
        },
        className: 'rbc-event-ghost',
      };
    }
    // 真实事件：微渐变背景
    const lv = overlapMap.get(event.id) || 1;
    const c = colorForOverlap(lv);
    return {
      style: {
        background: eventGradient(c),
        color: c.text,
        border: 'none',
        borderRadius: '5px',
        opacity: 0.92,
      },
    };
  }, [overlapMap, lcGhostOverlap]);

  // ── 图例渐变条 ──
  const legendGradient = (() => {
    const stops = [1, 2, 3, 5, 8];
    const colors = stops.map(n => colorForOverlap(n).bg);
    return `linear-gradient(90deg, ${colors.join(', ')})`;
  })();

  const eventWrapperComp = (props) => {
    const lv = (props.event && overlapMap.get(props.event.id)) || 1;
    return <DragEventWrapper {...props} onDelete={handleDelete} overlapLevel={lv} />;
  };

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
            <button className="add-btn" onClick={() => { setEditingEvent(null); setShowEventModal(true); }}>＋ 添加任务</button>
            <button className="undo-btn" onClick={undo} disabled={history.length <= 1}>↩ 撤销</button>
          </div>
        </div>
        <div className="legend">
          <span className="legend-item">
            <span className="legend-label-left">低压力</span>
            <span className="legend-gradient" style={{ background: legendGradient }} />
            <span className="legend-label-right">高压力</span>
          </span>
        </div>
        <div className="calendar-wrapper">
          <DropTarget onDrop={handleDrop}>
            <Calendar
              localizer={localizer}
              events={allDisplayEvents}
              defaultView="month"
              defaultDate={new Date(2026, 4, 25)}
              eventPropGetter={eventPropGetter}
              components={{ eventWrapper: eventWrapperComp }}
              onDoubleClickEvent={handleDoubleClick}
              popup
              views={['month', 'week', 'day']}
            />
          </DropTarget>
        </div>

        {showEventModal && (
          <EventModal
            event={editingEvent}
            defaultDate={new Date(2026, 4, 25)}
            onSave={handleModalSave}
            onDelete={handleModalDelete}
            onClose={() => { setShowEventModal(false); setEditingEvent(null); }}
          />
        )}
      </div>
    </DndProvider>
  );
}
