/**
 * MySQL 连接池
 * 配置项可通过环境变量覆盖
 */
import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '123456',
  database: process.env.DB_NAME || 'energy_calendar',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
});

export default pool;
