export function formatLongDate(date) {
  return new Intl.DateTimeFormat('es-CL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(date)
}

export function getWeekRange(dateString) {
  const date = new Date(dateString + 'T00:00:00')
  const day = date.getDay()
  const diff = date.getDate() - day + (day === 0 ? -6 : 1)
  const start = new Date(date.setDate(diff))
  const end = new Date(new Date(start).setDate(start.getDate() + 6))
  
  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0]
  }
}

export function getCurrentISODate() {
  return new Date().toISOString().split('T')[0]
}
