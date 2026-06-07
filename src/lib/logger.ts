type Level = 'info' | 'warn' | 'error'
type Ctx = Record<string, unknown>

function emit(level: Level, message: string, ctx?: Ctx): void {
  const entry = { level, message, ts: new Date().toISOString(), ...ctx }
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  fn(JSON.stringify(entry))
}

export const log = {
  info:  (message: string, ctx?: Ctx) => emit('info',  message, ctx),
  warn:  (message: string, ctx?: Ctx) => emit('warn',  message, ctx),
  error: (message: string, ctx?: Ctx) => emit('error', message, ctx),
}
