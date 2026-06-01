/**
 * 精力感知日历 — Express API 服务器
 * 启动: node server/index.js
 */
import express from 'express';
import cors from 'cors';
import pool from './db.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ── 工具：蛇形 ↔ 驼峰映射 ──
function rowToEvent(row) {
  return {
    id: row.id,
    title: row.title,
    start: new Date(row.start_time),
    end: new Date(row.end_time),
    description: row.description || '',
  };
}

// ═══════════════ ROUTES ═══════════════

// GET /api/tasks — 获取所有任务
app.get('/api/tasks', async (_req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, title, start_time, end_time, description FROM tasks ORDER BY start_time'
    );
    res.json(rows.map(rowToEvent));
  } catch (err) {
    console.error('GET /api/tasks error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/tasks — 创建任务
app.post('/api/tasks', async (req, res) => {
  try {
    const { title, start, end, description = '' } = req.body;
    if (!title || !start || !end) {
      return res.status(400).json({ error: 'title, start, end 为必填字段' });
    }
    const [result] = await pool.query(
      'INSERT INTO tasks (title, start_time, end_time, description) VALUES (?, ?, ?, ?)',
      [title, new Date(start), new Date(end), description]
    );
    const [rows] = await pool.query('SELECT * FROM tasks WHERE id = ?', [result.insertId]);
    res.status(201).json(rowToEvent(rows[0]));
  } catch (err) {
    console.error('POST /api/tasks error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/tasks/:id — 全量更新任务
app.patch('/api/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, start, end, description = '' } = req.body;
    if (!title || !start || !end) {
      return res.status(400).json({ error: 'title, start, end 为必填字段' });
    }
    const [result] = await pool.query(
      'UPDATE tasks SET title = ?, start_time = ?, end_time = ?, description = ? WHERE id = ?',
      [title, new Date(start), new Date(end), description, id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: '任务不存在' });
    }
    const [rows] = await pool.query('SELECT * FROM tasks WHERE id = ?', [id]);
    res.json(rowToEvent(rows[0]));
  } catch (err) {
    console.error(`PATCH /api/tasks/${id} error:`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/tasks/:id/time — 精准时间更新（拖拽专用）
app.patch('/api/tasks/:id/time', async (req, res) => {
  try {
    const { id } = req.params;
    const { start, end } = req.body;
    if (!start || !end) {
      return res.status(400).json({ error: 'start, end 为必填字段' });
    }
    const [result] = await pool.query(
      'UPDATE tasks SET start_time = ?, end_time = ? WHERE id = ?',
      [new Date(start), new Date(end), id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: '任务不存在' });
    }
    const [rows] = await pool.query('SELECT * FROM tasks WHERE id = ?', [id]);
    res.json(rowToEvent(rows[0]));
  } catch (err) {
    console.error(`PATCH /api/tasks/${id}/time error:`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/tasks/:id — 删除任务
app.delete('/api/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await pool.query('DELETE FROM tasks WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: '任务不存在' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error(`DELETE /api/tasks/${id} error:`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── 启动 ──
app.listen(PORT, () => {
  console.log(`✅ 日历 API 服务器已启动 → http://localhost:${PORT}`);
  console.log(`   GET    /api/tasks          — 获取所有任务`);
  console.log(`   POST   /api/tasks          — 创建任务`);
  console.log(`   PATCH  /api/tasks/:id      — 更新任务`);
  console.log(`   PATCH  /api/tasks/:id/time — 更新时间`);
  console.log(`   DELETE /api/tasks/:id      — 删除任务`);
});
