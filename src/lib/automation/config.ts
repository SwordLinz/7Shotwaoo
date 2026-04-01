/**
 * 外部自动化（OpenClaw / 脚本）环境变量：
 * - WACOO_AUTOMATION_TOKEN：Bearer Token，必填（生产环境）
 * - WACOO_AUTOMATION_USER_ID：执行流水线所使用的用户 id（须已在系统中存在并配置好模型与 API Key）
 * - WACOO_EXPORT_ROOT：成片导出目录（例如 D:\7shot\Wacoo\Wacoo-out）
 * - WACOO_INTERNAL_BASE_URL：服务端自拉取媒体时的站点根 URL，默认取 INTERNAL_APP_URL / NEXTAUTH_URL / http://127.0.0.1:3000
 */

export function getAutomationToken(): string {
  return (process.env.WACOO_AUTOMATION_TOKEN || '').trim()
}

export function getAutomationUserId(): string {
  return (process.env.WACOO_AUTOMATION_USER_ID || '').trim()
}

export function getExportRoot(): string {
  return (process.env.WACOO_EXPORT_ROOT || '').trim()
}

export function getInternalBaseUrl(): string {
  const raw =
    process.env.WACOO_INTERNAL_BASE_URL
    || process.env.INTERNAL_APP_URL
    || process.env.INTERNAL_TASK_API_BASE_URL
    || process.env.NEXTAUTH_URL
    || 'http://127.0.0.1:3000'
  return raw.replace(/\/$/, '')
}
