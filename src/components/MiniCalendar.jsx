import { useState, useEffect } from 'react'

export function MiniCalendar({ selectedDate, onDateSelect, activeDates = [] }) {
  const [currentMonth, setCurrentMonth] = useState(new Date(selectedDate + 'T12:00:00'))

  useEffect(() => {
    setCurrentMonth(new Date(selectedDate + 'T12:00:00'))
  }, [selectedDate])
  
  const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate()
  const startDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay()
  
  const months = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]
  const daysOfWeek = ["D", "L", "M", "Mi", "J", "V", "S"]

  const handlePrev = (e) => {
    e.preventDefault()
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))
  }
  
  const handleNext = (e) => {
    e.preventDefault()
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))
  }

  const handleDayClick = (day) => {
    const d = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day)
    onDateSelect(d.toISOString().split('T')[0])
  }

  const calendarDays = []
  // Fill empty slots before month starts
  for (let i = 0; i < startDay; i++) calendarDays.push(null)
  // Fill month days
  for (let i = 1; i <= daysInMonth(currentMonth.getFullYear(), currentMonth.getMonth()); i++) calendarDays.push(i)

  return (
    <div className="mini-calendar">
      <div className="calendar-header">
        <button type="button" onClick={handlePrev} className="month-nav">&lt;</button>
        <span className="month-label">{months[currentMonth.getMonth()]} {currentMonth.getFullYear()}</span>
        <button type="button" onClick={handleNext} className="month-nav">&gt;</button>
      </div>
      <div className="calendar-grid">
        {daysOfWeek.map(d => <div key={d} className="grid-dayheader">{d}</div>)}
        {calendarDays.map((day, ix) => {
          if (!day) return <div key={ix} className="grid-day empty"></div>
          
          const dateStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const isSelected = selectedDate === dateStr
          const isHighlighted = activeDates.includes(dateStr)
          const isToday = new Date().toISOString().split('T')[0] === dateStr

          return (
            <div 
              key={ix} 
              className={`grid-day ${isSelected ? 'is-selected' : ''} ${isHighlighted ? 'has-activity' : ''} ${isToday ? 'is-today' : ''}`}
              onClick={() => handleDayClick(day)}
            >
              {day}
            </div>
          )
        })}
      </div>
      <div className="calendar-footer">
        <div className="footer-item"><span className="dot activity"></span> Coberturas</div>
        <div className="footer-item"><span className="dot today"></span> Hoy</div>
      </div>
    </div>
  )
}
