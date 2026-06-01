/**
 * API 服务层 — 与后端 Express 通信
 * 后端不可用时静默降级，前端仍可正常使用本地状态
 */

const BASE_URL = 'http://localhost:3001/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = new Error(`API ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// ── CRUD ──

export async function fetchTasks() {
  return request('/tasks');
}

export async function createTask({ title, start, end, description = '' }) {
  return request('/tasks', {
    method: 'POST',
    body: JSON.stringify({ title, start, end, description }),
  });
}

export async function updateTask(id, { title, start, end, description }) {
  return request(`/tasks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ title, start, end, description }),
  });
}

/** 仅更新时间字段（精准接口） */
export async function updateTaskTime(id, start, end) {
  return request(`/tasks/${id}/time`, {
    method: 'PATCH',
    body: JSON.stringify({ start, end }),
  });
}

export async function deleteTask(id) {
  return request(`/tasks/${id}`, { method: 'DELETE' });
}

// ── 防抖队列（按任务 ID 合并，300ms）──

const timeQueue = new Map();

export function debouncedUpdateTime(id, start, end) {
  const key = `time_${id}`;
  if (timeQueue.has(key)) {
    clearTimeout(timeQueue.get(key));
  }
  const timer = setTimeout(async () => {
    timeQueue.delete(key);
    try {
      await updateTaskTime(id, start, end);
    } catch {
      // 静默失败 — 下次刷新时会从数据库恢复
    }
  }, 300);
  timeQueue.set(key, timer);
}
