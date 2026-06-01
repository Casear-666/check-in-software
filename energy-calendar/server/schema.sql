-- 精力感知日历 — 数据库初始化脚本
-- 运行方式: mysql -u root < server/schema.sql

CREATE DATABASE IF NOT EXISTS energy_calendar
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE energy_calendar;

CREATE TABLE IF NOT EXISTS tasks (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  title       VARCHAR(255)  NOT NULL,
  start_time  DATETIME      NOT NULL,
  end_time    DATETIME      NOT NULL,
  description TEXT,
  created_at  DATETIME      DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- 联合索引：支撑重叠校验与时间段查询
  INDEX idx_time_range (start_time, end_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
