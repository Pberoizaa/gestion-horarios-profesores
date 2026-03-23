import { useState, useEffect } from 'react'
import { supabase } from '../services/supabase'
import * as XLSX from 'xlsx'
import logo from '../assets/logo.jpg'
import { formatLongDate, getWeekRange } from '../services/dateUtils'
import { BLOQUES, DIAS, DURACION_BLOQUE_H } from '../services/constants'
import { getDetailedBudget, formatUsage } from '../services/budgetUtils'



function AdminDashboard() {
  const [profesores, setProfesores] = useState([])
  const [loading, setLoading] = useState(true)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [newProf, setNewProf] = useState({ 
    nombre: '', 
    email: '', 
    cargo: '', 
    rol: 'profesor', 
    contrato_horas: 0, 
    horas_excedentes: 0,
    horas_no_lectivas: 0,
    password: '' 
  })
  const [processing, setProcessing] = useState(false)
  const [activeTab, setActiveTab] = useState('profesores')
  
  // Coverage Planner State
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])
  const [absentTeacherId, setAbsentTeacherId] = useState('')
  const [absentSchedule, setAbsentSchedule] = useState([])
  const [allSchedules, setAllSchedules] = useState([])
  const [assignments, setAssignments] = useState({}) // { horarioId: substituteId }
  const [plannedCoverages, setPlannedCoverages] = useState([])
  const [plannerLoading, setPlannerLoading] = useState(false)
  
  // Reemplazos de Larga Duración State
  const [reemplazos, setReemplazos] = useState([])
  const [newReemplazo, setNewReemplazo] = useState({ 
    profesor_ausente_id: '', 
    profesor_reemplazante_id: '', 
    fecha_inicio: '', 
    fecha_fin: '', 
    motivo: '' 
  })
  
  // Gestión de Horarios State
  const [asignaturas, setAsignaturas] = useState([])
  const [selectedTeacherId, setSelectedTeacherId] = useState('')
  const [teacherSchedule, setTeacherSchedule] = useState([])
  const [teacherCoverages, setTeacherCoverages] = useState([])
  const [totalCoverageUsage, setTotalCoverageUsage] = useState(0)
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false)
  const [editingBlock, setEditingBlock] = useState(null) // { dia, bloque, item? }
  const [newBlock, setNewBlock] = useState({ 
    asignatura_id: '', 
    tipo_bloque: 'clase', 
    curso: '',
    dia_semana: 1,
    bloque_id: 1
  })


  useEffect(() => {
    fetchProfesores()
    fetchReemplazos()
    fetchAsignaturas()
  }, [])

  useEffect(() => {
    if (activeTab === 'horarios' && selectedTeacherId) {
      fetchTeacherSchedule()
    }
  }, [activeTab, selectedTeacherId])

  useEffect(() => {
    if (activeTab === 'coberturas' && absentTeacherId) {
      fetchPlannerData()
      fetchPlannedCoverages()
    }
  }, [activeTab, absentTeacherId, selectedDate])

  // Real-time Subscriptions
  useEffect(() => {
    const channel = supabase
      .channel('admin_realtime_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'coberturas' }, (payload) => {
        console.log('Realtime coverage change:', payload)
        fetchPlannedCoverages()
        if (activeTab === 'coberturas') fetchPlannerData()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profesores' }, () => {
        fetchProfesores() // Refresh teacher list and budgets
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'horarios' }, () => {
        if (activeTab === 'coberturas') fetchPlannerData()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reemplazos_periodos' }, () => {
        fetchReemplazos()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [activeTab])

  async function fetchPlannerData() {
    setPlannerLoading(true)
    try {
      const dateObj = new Date(selectedDate + 'T00:00:00')
      const diaSemana = dateObj.getDay() // 0 = Sun, 1 = Mon ...
      
      if (diaSemana === 0 || diaSemana === 6) {
        setAbsentSchedule([])
        return
      }

      // 1. Fetch absent teacher's schedule for that day
      const { data: schedule, error: sError } = await supabase
        .from('horarios')
        .select('*, asignaturas(nombre)')
        .eq('profesor_id', absentTeacherId)
        .eq('dia_semana', diaSemana)
        .order('hora_inicio')
      
      if (sError) throw sError

      // Filter for Friday (early exit after block 6) AND Block 10 (TC only)
      const filteredSchedule = schedule.filter(s => {
        const block = BLOQUES.find(b => b.inicio.startsWith(s.hora_inicio.slice(0,5)))
        if (!block) return false
        if (diaSemana === 5 && block.id > 6) return false
        if (block.id === 10) return false // TC only, students gone
        return true
      })

      setAbsentSchedule(filteredSchedule)

      // 2. Fetch ALL schedules for that day (to check busy status)
      const { data: daySchedules, error: asError } = await supabase
        .from('horarios')
        .select('*')
        .eq('dia_semana', diaSemana)
      
      if (asError) throw asError
      
      // 3. Fetch ALL schedules across the week (to calculate total TC usage)
      const { data: allS, error: weeklyError } = await supabase
        .from('horarios')
        .select('*')
      
      if (weeklyError) throw weeklyError

      setAllSchedules(allS) // This now contains everything
      
      // Update: use daySchedules for initial busy check, or just filter allS later.
      // For simplicity, I'll store allS and filter by day in getAvailableTeachers.
      
      // Reset assignments
      setAssignments({})

    } catch (error) {
      console.error('Error fetching planner data:', error.message)
    } finally {
      setPlannerLoading(false)
    }
  }

  const getAvailableTeachers = (horaInicio) => {
    // 1. Teachers who DON'T have a class at this time
    const busyTeacherIds = allSchedules
      .filter(s => s.dia_semana === DIAS.find(d => d.corto === new Date(selectedDate + 'T00:00:00').toLocaleDateString('es-ES', {weekday: 'short'}).toUpperCase().slice(0,2))?.id && s.hora_inicio === horaInicio)
      .map(s => s.profesor_id)
    
    // 2. Map available teachers with their budget info
    return profesores
      .filter(p => p.activo && p.rol === 'profesor' && !busyTeacherIds.includes(p.id))
      .map(p => {
        // Count planned coverages for the SAME week as selectedDate
        const { start, end } = getWeekRange(selectedDate)
        const weekCoveragesCount = plannedCoverages.filter(c => 
          c.profesor_reemplazante_id === p.id && 
          c.estado !== 'cancelada' &&
          c.fecha >= start && 
          c.fecha <= end
        ).length

        const budget = getDetailedBudget(p.horas_excedentes, p.horas_no_lectivas)
        const remaining = budget.total - weekCoveragesCount
        const isOverSurplus = weekCoveragesCount >= budget.surplus

        return { 
          ...p, 
          usage: weekCoveragesCount, 
          budget, 
          remaining,
          isOverSurplus
        }
      })
  }

  async function handleSaveCoverages() {
    // ... same as before but add fetchPlannedCoverages() after success
    // I'll update the whole handleSaveCoverages to be safe
    const coverageEntries = []
    const overBudgetTeachers = []

    for (const [horarioId, subId] of Object.entries(assignments)) {
      if (!subId) continue
      
      const teacher = getAvailableTeachers('').find(p => p.id === subId) // Re-calc is cheap here
      if (teacher && teacher.remaining < 1) {
        overBudgetTeachers.push(teacher.nombre)
      }

      coverageEntries.push({
        profesor_ausente_id: absentTeacherId,
        profesor_reemplazante_id: subId,
        fecha: selectedDate,
        horario_id: horarioId,
        estado: 'pendiente'
      })
    }

    if (overBudgetTeachers.length > 0) {
      if (!confirm(`Advertencia: ${overBudgetTeachers.join(', ')} superará(n) su presupuesto semanal de horas no lectivas. ¿Deseas continuar?`)) {
        return
      }
    }

    if (coverageEntries.length === 0) {
      alert('No hay asignaciones para guardar.')
      return
    }

    setProcessing(true)
    try {
      const { error } = await supabase.from('coberturas').insert(coverageEntries)
      if (error) throw error
      alert('Coberturas guardadas con éxito.')
      setAssignments({})
      fetchPlannedCoverages()
    } catch (error) {
      alert('Error guardando coberturas: ' + error.message)
    } finally {
      setProcessing(false)
    }
  }

  async function fetchPlannedCoverages() {
    try {
      const { data, error } = await supabase
        .from('coberturas')
        .select('*, ausente:profesores!profesor_ausente_id(nombre), reemplazo:profesores!profesor_reemplazante_id(nombre), horarios(*)')
        .order('fecha', { ascending: false })
        .limit(20)
      
      if (error) throw error
      setPlannedCoverages(data)
    } catch (error) {
      console.error('Error fetching planned coverages:', error.message)
    }
  }

  async function handleDeleteCoverage(id) {
    if (!confirm('¿Eliminar esta planificación?')) return
    try {
      const { error } = await supabase.from('coberturas').delete().eq('id', id)
      if (error) throw error
      fetchPlannedCoverages()
    } catch (error) {
      alert('Error al eliminar: ' + error.message)
    }
  }

  async function fetchProfesores() {
    try {
      const { data, error } = await supabase
        .from('profesores')
        .select('*')
        .order('nombre')
      
      if (error) throw error
      setProfesores(data)
    } catch (error) {
      console.error('Error fetching profesores:', error.message)
    } finally {
      setLoading(false)
    }
  }

  async function fetchAsignaturas() {
    try {
      const { data, error } = await supabase.from('asignaturas').select('*').order('nombre')
      if (error) throw error
      setAsignaturas(data)
    } catch (error) {
      console.error('Error fetching asignaturas:', error.message)
    }
  }

  async function fetchTeacherSchedule() {
    if (!selectedTeacherId) return
    setPlannerLoading(true)
    try {
      // 1. Fetch own schedule
      const { data: schedule, error: sError } = await supabase
        .from('horarios')
        .select('*, asignaturas(nombre)')
        .eq('profesor_id', selectedTeacherId)
      
      if (sError) throw sError
      setTeacherSchedule(schedule)

      // 2. Fetch coverages for the current week where this teacher is the replacement
      const { start, end } = getWeekRange(new Date().toISOString().split('T')[0])
      const { data: coverages, error: cError } = await supabase
        .from('coberturas')
        .select('*, ausente:profesores!profesor_ausente_id(nombre), horarios(*, asignaturas(nombre))')
        .eq('profesor_reemplazante_id', selectedTeacherId)
        .gte('fecha', start)
        .lte('fecha', end)
        .neq('estado', 'cancelada')
      
      if (cError) throw cError
      setTeacherCoverages(coverages)

      // 3. Fetch TOTAL coverage usage (for the budget counter)
      const { count, error: countError } = await supabase
        .from('coberturas')
        .select('*', { count: 'exact', head: true })
        .eq('profesor_reemplazante_id', selectedTeacherId)
        .neq('estado', 'cancelada')
      
      if (countError) throw countError
      setTotalCoverageUsage(count || 0)

    } catch (error) {
      console.error('Error fetching teacher schedule:', error.message)
    } finally {
      setPlannerLoading(false)
    }
  }

  const getTeacherHorarioAt = (diaId, horaInicio) => {
    // Check own schedule first
    const own = teacherSchedule.find(h => 
      h.dia_semana === diaId && 
      (h.hora_inicio.slice(0, 5) === horaInicio.slice(0, 5))
    )
    if (own) return own

    // Check coverages in the selected week
    const currentWeekDate = new Date()
    const coverage = teacherCoverages.find(c => {
      const cDate = new Date(c.fecha + 'T00:00:00')
      const cDay = cDate.getDay() === 0 ? 7 : cDate.getDay()
      return cDay === diaId && c.horarios?.hora_inicio?.slice(0, 5) === horaInicio.slice(0, 5)
    })

    if (coverage) {
      return {
        ...coverage.horarios,
        isInherited: true,
        ausenteNombre: coverage.ausente?.nombre
      }
    }

    return null
  }

  const handleSaveBlock = async (e) => {
    if (e) e.preventDefault()
    // Basic session diagnostic
    const { data: { session } } = await supabase.auth.getSession()
    console.log('Session User:', session?.user?.email)
    console.log('JWT Payload:', session?.access_token ? JSON.parse(atob(session.access_token.split('.')[1])) : 'No Token')

    // Basic validation
    if (['clase', 'administrativo'].includes(newBlock.tipo_bloque) && !newBlock.asignatura_id) {
      alert('Por favor selecciona una asignatura')
      return
    }

    if (newBlock.tipo_bloque === 'clase' && !newBlock.curso) {
      alert('Por favor ingresa el curso (ej: 3°F)')
      return
    }

    setProcessing(true)
    try {
      const targetBlock = BLOQUES.find(b => b.id === Number(newBlock.bloque_id))
      const payload = {
        profesor_id: selectedTeacherId,
        asignatura_id: ['clase', 'administrativo'].includes(newBlock.tipo_bloque) ? newBlock.asignatura_id : null,
        tipo_bloque: newBlock.tipo_bloque,
        curso: newBlock.tipo_bloque === 'clase' ? newBlock.curso : null,
        dia_semana: Number(newBlock.dia_semana),
        hora_inicio: targetBlock.inicio,
        hora_fin: targetBlock.fin
      }

      // If moving or adding, check if there's an existing block at the TARGET to decide if we update IT or insert
      const { data: existing } = await supabase
        .from('horarios')
        .select('id')
        .eq('profesor_id', selectedTeacherId)
        .eq('dia_semana', payload.dia_semana)
        .eq('hora_inicio', payload.hora_inicio)
        .maybeSingle()

      const isMove = editingBlock.item && (
        editingBlock.item.dia_semana !== payload.dia_semana ||
        editingBlock.item.hora_inicio.slice(0, 5) !== payload.hora_inicio.slice(0, 5)
      )

      if (isMove) {
        // 1. Delete the OLD position record
        await supabase.from('horarios').delete().eq('id', editingBlock.item.id)
        
        // 2. Check if TARGET already occupied
        if (existing) {
          // Overwrite existing target
          const { error: err } = await supabase.from('horarios').update(payload).eq('id', existing.id)
          if (err) throw err
          alert('ÉXITO: El bloque se ha movido y se ha sobreescrito el bloque que estaba en el destino.')
        } else {
          // Insert into empty target
          const { data: newData, error: err } = await supabase.from('horarios').insert([payload]).select()
          if (err) throw err
          alert('ÉXITO: El bloque se ha movido correctamente a la nueva posición.')
          if (newData && newData[0]) setEditingBlock({ ...editingBlock, item: newData[0] })
        }
      } else if (editingBlock.item || existing) {
        // Simple update of the same spot or adding to a slot that already had something
        const updateId = editingBlock.item?.id || existing?.id
        const { error: err } = await supabase.from('horarios').update(payload).eq('id', updateId)
        if (err) throw err
        alert('ÉXITO: Los cambios se han guardado.')
        if (editingBlock.item) setEditingBlock({ ...editingBlock, item: { ...editingBlock.item, ...payload } })
      } else {
        // Brand new insert
        const { data: newData, error: err } = await supabase.from('horarios').insert([payload]).select()
        if (err) throw err
        alert('ÉXITO: El bloque se ha creado correctamente.')
        if (newData && newData[0]) setEditingBlock({ ...editingBlock, item: newData[0] })
      }

      await fetchTeacherSchedule()
    } catch (err) {
      console.error('Error saving block:', err)
      alert('ERROR AL GUARDAR: ' + err.message + '\n\nPor favor verifica los datos o contacta a soporte.')
    } finally {
      setProcessing(false)
    }
  }

  async function handleDeleteBlock(e) {
    if (e) e.preventDefault()
    if (!editingBlock?.item) return
    if (!confirm('¿Eliminar este bloque del horario?')) return

    setProcessing(true)
    try {
      const { data: deleted, error, count } = await supabase
        .from('horarios')
        .delete()
        .eq('id', editingBlock.item.id)
        .select()
      
      if (error) throw error
      if (!deleted || deleted.length === 0) {
        alert('ADVERTENCIA: No se eliminó ningún registro. Es posible que el ID ya no exista o que los permisos lo impiden.')
      } else {
        alert('ÉXITO: Bloque eliminado correctamente.')
      }
      setIsScheduleModalOpen(false)
      fetchTeacherSchedule()
    } catch (error) {
      alert('Error: ' + error.message)
    } finally {
      setProcessing(false)
    }
  }

  const exportScheduleToExcel = (profesor, schedule) => {
    // Preparar encabezados
    const headers = ["Bloque / Hora", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes"]
    
    // Preparar filas
    const rows = BLOQUES.map(b => {
      const row = [`${b.id}° (${b.inicio}-${b.fin})`]
      DIAS.forEach(d => {
        const item = schedule.find(h => 
          h.dia_semana === d.id && 
          (h.hora_inicio.slice(0, 5) === b.inicio.slice(0, 5))
        )
        if (item) {
          const type = item.tipo_bloque?.trim().toLowerCase()
          let text = ""
          if (type === 'tc') text = "TRABAJO COLAB."
          else if (type === 'dupla') text = "DUPLA SICOSOCIAL"
          else if (type === 'apoderado') text = "ATENCIÓN APODERADO"
          else text = item.asignaturas?.nombre || 'Administrativo'
          
          if (item.curso && item.curso !== 'N/A') text += ` (${item.curso})`
          row.push(text)
        } else {
          row.push("")
        }
      })
      return row
    })

    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows])
    
    // Ajustar anchos de columna
    worksheet['!cols'] = [
      { wch: 20 }, // Bloque
      { wch: 25 }, // Lu
      { wch: 25 }, // Ma
      { wch: 25 }, // Mi
      { wch: 25 }, // Ju
      { wch: 25 }  // Vi
    ]

    return worksheet
  }

  const handleExportIndividual = () => {
    if (!selectedTeacherId || teacherSchedule.length === 0) {
      alert("Por favor selecciona un profesor con horario cargado.")
      return
    }
    const prof = profesores.find(p => p.id === selectedTeacherId)
    const ws = exportScheduleToExcel(prof, teacherSchedule)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Horario")
    XLSX.writeFile(wb, `Horario_${prof.nombre.replace(/\s+/g, '_')}.xlsx`)
  }

  const handleExportAll = async () => {
    setProcessing(true)
    try {
      // 1. Obtener todos los horarios de la base de datos
      const { data: rawAllSchedules, error } = await supabase
        .from('horarios')
        .select('*, asignaturas(nombre)')
      
      if (error) throw error

      const wb = XLSX.utils.book_new()

      // 2. Crear una hoja por cada profesor
      profesores.forEach(prof => {
        const profSchedule = rawAllSchedules.filter(h => h.profesor_id === prof.id)
        if (profSchedule.length > 0) {
          const ws = exportScheduleToExcel(prof, profSchedule)
          // Limitar nombre de hoja a 31 caracteres (Excel limit)
          const sheetName = prof.nombre.substring(0, 31)
          XLSX.utils.book_append_sheet(wb, ws, sheetName)
        }
      })

      if (wb.SheetNames.length === 0) {
        alert("No hay horarios cargados para exportar.")
        return
      }

      XLSX.writeFile(wb, `Horarios_Completos_IC.xlsx`)
    } catch (error) {
      alert("Error exportando horarios: " + error.message)
    } finally {
      setProcessing(false)
    }
  }

  const handleExportSpecialized = async (tipo) => {
    setProcessing(true)
    try {
      const label = tipo === 'apoderado' ? 'Atención Apoderados' : 'Dupla Sicosocial'
      
      const { data: rawData, error } = await supabase
        .from('horarios')
        .select('*, profesores(nombre)')
        .eq('tipo_bloque', tipo)
      
      if (error) throw error

      if (!rawData || rawData.length === 0) {
        alert(`No hay registros de ${label} para exportar.`)
        return
      }

      const headers = ["Profesor", "Día", "Bloque", "Horario"]
      const rows = rawData.map(item => [
        item.profesores?.nombre || 'Desconocido',
        DIAS.find(d => d.id === item.dia_semana)?.nombre || item.dia_semana,
        BLOQUES.find(b => b.inicio.slice(0, 5) === item.hora_inicio.slice(0, 5))?.id + "°",
        `${item.hora_inicio.slice(0, 5)} - ${item.hora_fin.slice(0, 5)}`
      ])

      // Ordenar por nombre de profesor
      rows.sort((a, b) => a[0].localeCompare(b[0]))

      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
      ws['!cols'] = [{ wch: 30 }, { wch: 15 }, { wch: 10 }, { wch: 20 }]

      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, "Resumen")
      XLSX.writeFile(wb, `Resumen_${tipo === 'apoderado' ? 'Apoderados' : 'Duplas'}.xlsx`)
    } catch (error) {
      alert("Error en el reporte: " + error.message)
    } finally {
      setProcessing(false)
    }
  }

  const openScheduleModal = (dia, bloque, item = null) => {
    setEditingBlock({ dia, bloque, item })
    if (item) {
      setNewBlock({
        asignatura_id: item.asignatura_id || '',
        tipo_bloque: item.tipo_bloque || 'clase',
        curso: item.curso || '',
        dia_semana: item.dia_semana,
        bloque_id: BLOQUES.find(b => b.inicio.slice(0, 5) === item.hora_inicio.slice(0, 5))?.id || bloque
      })
    } else {
      setNewBlock({ 
        asignatura_id: '', 
        tipo_bloque: 'clase', 
        curso: '',
        dia_semana: dia,
        bloque_id: bloque
      })
    }
    setIsScheduleModalOpen(true)
  }

  async function fetchReemplazos() {
    try {
      const { data, error } = await supabase
        .from('reemplazos_periodos')
        .select('*, ausente:profesores!profesor_ausente_id(nombre), reemplazo:profesores!profesor_reemplazante_id(nombre)')
        .order('fecha_inicio', { ascending: false })
      
      if (error) throw error
      setReemplazos(data)
    } catch (error) {
      console.error('Error fetching reemplazos:', error.message)
    }
  }

  async function handleSaveReemplazo(e) {
    e.preventDefault()
    setProcessing(true)
    try {
      // 1. Insert the replacement period
      const { data: newPeriod, error } = await supabase
        .from('reemplazos_periodos')
        .insert([newReemplazo])
        .select()
        .single()
      
      if (error) throw error
      
      // 2. Fetch the absent teacher's schedule to duplicate it as coverages
      const { data: schedule, error: sError } = await supabase
        .from('horarios')
        .select('*')
        .eq('profesor_id', newReemplazo.profesor_ausente_id)
      
      if (sError) throw sError

      // 3. Generate individual coverages for each day in range
      const startDate = new Date(newReemplazo.fecha_inicio + 'T00:00:00')
      const endDate = new Date(newReemplazo.fecha_fin + 'T00:00:00')
      const coveragesToInsert = []
      
      // Limit to 60 days to avoid huge loops/errors
      let loopCount = 0
      for (let d = new Date(startDate); d <= endDate && loopCount < 60; d.setDate(d.getDate() + 1)) {
        loopCount++
        const diaSemana = d.getDay() // 0=Sun, 1=Mon, ..., 6=Sat
        const dbDiaSemana = diaSemana === 0 ? 7 : diaSemana // Convert to 1-7
        
        // Skip weekends
        if (dbDiaSemana > 5) continue
        
        const fechaStr = d.toISOString().split('T')[0]
        
        // Find blocks for this day
        const dayBlocks = schedule.filter(h => h.dia_semana === dbDiaSemana)
        
        for (const block of dayBlocks) {
          coveragesToInsert.push({
            profesor_ausente_id: newReemplazo.profesor_ausente_id,
            profesor_reemplazante_id: newReemplazo.profesor_reemplazante_id,
            fecha: fechaStr,
            horario_id: block.id,
            estado: 'pendiente'
          })
        }
      }

      if (coveragesToInsert.length > 0) {
        // Chunk inserts if too many (Supabase limit is usually high but safe is better)
        const { error: cError } = await supabase.from('coberturas').insert(coveragesToInsert)
        if (cError) throw cError
      }

      alert(`Reemplazo registrado con éxito. Se han cargado ${coveragesToInsert.length} bloques de clase al reemplazante.`)
      setNewReemplazo({ profesor_ausente_id: '', profesor_reemplazante_id: '', fecha_inicio: '', fecha_fin: '', motivo: '' })
      fetchReemplazos()
    } catch (error) {
      alert('Error: ' + error.message)
    } finally {
      setProcessing(false)
    }
  }

  async function handleDeleteReemplazo(id) {
    if (!confirm('¿Eliminar este registro de reemplazo?')) return
    try {
      const { error } = await supabase.from('reemplazos_periodos').delete().eq('id', id)
      if (error) throw error
      fetchReemplazos()
    } catch (error) {
      alert('Error al eliminar: ' + error.message)
    }
  }

  async function handleSaveProfessor(e) {
    e.preventDefault()
    setProcessing(true)
    try {
      // Auto-append domain if missing
      let finalEmail = newProf.email.trim()
      if (finalEmail && !finalEmail.includes('@')) {
        finalEmail += '@icomercialpmt.cl'
      }

      if (isEditing) {
        // If password is provided, use edge function to update Auth
        if (newProf.password) {
          const { data: authData, error: authError } = await supabase.functions.invoke('admin-update-user', {
            body: { userId: editingId, password: newProf.password }
          })
          
          if (authError) {
             const errorMsg = authError.context?.error?.message || authError.message || 'Error de red en la función'
             throw new Error(`Error de conexión: ${errorMsg}`)
          }

          if (authData && authData.success === false) {
             throw new Error(`Error de Supabase: ${authData.error}`)
          }
        }

        const { error } = await supabase.rpc('update_professor', {
          p_id: editingId,
          p_nombre: newProf.nombre,
          p_email: finalEmail,
          p_cargo: newProf.cargo,
          p_rol: newProf.rol,
          p_contrato_horas: newProf.contrato_horas,
          p_horas_excedentes: newProf.horas_excedentes,
          p_horas_no_lectivas: newProf.horas_no_lectivas
        })
        if (error) throw error

        // If password was changed, we set the flag (double-safe)
        if (newProf.password) {
          await supabase.from('profesores').update({ cambio_clave_pendiente: true }).eq('id', editingId)
        }
      } else {
        const { error } = await supabase.rpc('create_professor', {
          p_nombre: newProf.nombre,
          p_email: finalEmail,
          p_cargo: newProf.cargo,
          p_rol: newProf.rol,
          p_contrato_horas: newProf.contrato_horas,
          p_horas_excedentes: newProf.horas_excedentes,
          p_horas_no_lectivas: newProf.horas_no_lectivas
        })
        if (error) throw error
      }
      
      setIsModalOpen(false)
      setIsEditing(false)
      setEditingId(null)
      setNewProf({ 
        nombre: '', 
        email: '', 
        cargo: '', 
        rol: 'profesor', 
        contrato_horas: 0, 
        horas_excedentes: 0,
        horas_no_lectivas: 0,
        password: '' 
      })
      fetchProfesores()
      alert(isEditing ? 'Profesor actualizado con éxito' : 'Profesor creado con éxito. Clave por defecto: info1234')
    } catch (error) {
      alert('Error: ' + error.message)
    } finally {
      setProcessing(false)
    }
  }

  const openEditModal = (prof) => {
    setNewProf({
      nombre: prof.nombre,
      email: prof.email.replace('@icomercialpmt.cl', ''), 
      cargo: prof.cargo || '',
      rol: prof.rol,
      contrato_horas: prof.contrato_horas || 0,
      horas_excedentes: prof.horas_excedentes || 0,
      horas_no_lectivas: prof.horas_no_lectivas || 0,
      password: ''
    })
    setEditingId(prof.id)
    setIsEditing(true)
    setIsModalOpen(true)
  }

  const openAddModal = () => {
    setNewProf({ nombre: '', email: '', cargo: '', rol: 'profesor', contrato_horas: 0, password: '' })
    setIsEditing(false)
    setEditingId(null)
    setIsModalOpen(true)
  }

  async function handleDeleteProfessor(id, nombre) {
    if (!confirm(`¿Estás seguro de eliminar a ${nombre}? Esta acción no se puede deshacer.`)) return
    
    setProcessing(true)
    try {
      const { error } = await supabase.rpc('delete_professor', { p_id: id })
      if (error) throw error
      fetchProfesores()
    } catch (error) {
      alert('Error al eliminar: ' + error.message)
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div className="admin-dashboard">
      <header className="dashboard-header">
        <div className="header-info">
          <img src={logo} alt="IC Logo" className="logo-header" />
          <div className="header-text">
            <h1>Panel de Administración</h1>
            <p className="header-subtitle">Instituto Comercial Puerto Montt</p>
            <div className="header-date">{formatLongDate(new Date())}</div>
          </div>
        </div>
        <button className="logout-button" onClick={() => supabase.auth.signOut()}>
          Cerrar Sesión
        </button>
      </header>

      <main>
        <section className="admin-tabs">
          <button 
            className={`tab-button ${activeTab === 'profesores' ? 'active' : ''}`}
            onClick={() => setActiveTab('profesores')}
          >
            Gestión de Profesores
          </button>
          <button 
            className={`tab-button ${activeTab === 'coberturas' ? 'active' : ''}`}
            onClick={() => setActiveTab('coberturas')}
          >
            Planificación de Coberturas
          </button>
          <button 
            className={`tab-button ${activeTab === 'reemplazos' ? 'active' : ''}`}
            onClick={() => setActiveTab('reemplazos')}
          >
            Gestión de Reemplazos
          </button>
          <button 
            className={`tab-button ${activeTab === 'horarios' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('horarios')
              if (selectedTeacherId) fetchTeacherSchedule()
            }}
          >
            Gestión de Horarios
          </button>
        </section>

        {activeTab === 'profesores' ? (
          <>
            <section className="stats-grid">
              <div className="stat-card">
                <h3>Profesores Activos</h3>
                <p>{profesores.filter(p => p.activo).length}</p>
              </div>
              <div className="stat-card">
                <h3>Coberturas Pendientes</h3>
                <p>0</p>
              </div>
            </section>

            <section className="admin-actions">
              <h2>Gestión de Profesores</h2>
              <div className="action-buttons">
                <button className="primary" onClick={openAddModal}>+ Agregar Profesor</button>
              </div>
            </section>

            {isModalOpen && (
              <div className="modal-overlay">
                <div className="modal-content">
                  <h3>{isEditing ? 'Editar Profesor' : 'Agregar Nuevo Profesor'}</h3>
                  <form onSubmit={handleSaveProfessor}>
                    <div className="form-group">
                      <label>Nombre Completo</label>
                      <input 
                        type="text" 
                        required 
                        value={newProf.nombre} 
                        onChange={e => setNewProf({...newProf, nombre: e.target.value})} 
                      />
                    </div>
                    <div className="form-group">
                      <label>Email / Usuario</label>
                      <input 
                        type="text" 
                        required 
                        placeholder="usuario (ej: alfredo.vivar)"
                        value={newProf.email} 
                        onChange={e => setNewProf({...newProf, email: e.target.value})} 
                      />
                    </div>
                    <div className="form-group">
                      <label>Cargo / Especialidad</label>
                      <input 
                        type="text" 
                        value={newProf.cargo} 
                        onChange={e => setNewProf({...newProf, cargo: e.target.value})} 
                      />
                    </div>
                    <div className="form-group">
                      <label>Rol</label>
                      <select 
                        value={newProf.rol} 
                        onChange={e => setNewProf({...newProf, rol: e.target.value})}
                      >
                        <option value="profesor">Profesor</option>
                      </select>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                      <div className="form-group">
                        <label>Excedentes (Cronológicas)</label>
                        <input 
                          type="number" 
                          step="0.5"
                          value={newProf.horas_excedentes} 
                          onChange={e => setNewProf({...newProf, horas_excedentes: parseFloat(e.target.value) || 0})} 
                        />
                        <small style={{ opacity: 0.7 }}>→ ~{Math.floor((newProf.horas_excedentes || 0) * 1.33)} blq pedagógicos</small>
                      </div>
                      <div className="form-group">
                        <label>Horas No Lectivas</label>
                        <input 
                          type="number" 
                          step="0.5"
                          value={newProf.horas_no_lectivas} 
                          onChange={e => setNewProf({...newProf, horas_no_lectivas: parseFloat(e.target.value) || 0})} 
                        />
                      </div>
                    </div>
                    <div className="form-group">
                      <label>Horas de Contrato (Total)</label>
                      <input 
                        type="number" 
                        value={newProf.contrato_horas} 
                        onChange={e => setNewProf({...newProf, contrato_horas: parseInt(e.target.value) || 0})} 
                      />
                    </div>
                    <div className="form-group">
                      <label>Contraseña (dejar vacío para no cambiar)</label>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <input 
                          type="text" 
                          value={newProf.password} 
                          placeholder="Nueva contraseña..."
                          onChange={e => setNewProf({...newProf, password: e.target.value})} 
                        />
                        <button 
                          type="button" 
                          className="btn-edit" 
                          style={{ whiteSpace: 'nowrap' }}
                          onClick={() => setNewProf({...newProf, password: 'info1234'})}
                        >
                          Reset (info1234)
                        </button>
                      </div>
                    </div>
                    <div className="modal-actions">
                      <button type="button" className="btn-cancel" onClick={() => setIsModalOpen(false)}>Cancelar</button>
                      <button type="submit" className="btn-save" disabled={processing}>
                        {processing ? 'Guardando...' : 'Guardar'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            <section className="profesores-list">
              <h2>Lista de Profesores</h2>
              {loading ? (
                <p>Cargando lista...</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Nombre</th>
                      <th>Cargo</th>
                      <th>Contrato</th>
                      <th>Exced. (P)</th>
                      <th>No Lect.</th>
                      <th>Email</th>
                      <th>Rol</th>
                      <th>Estado</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profesores.map(p => (
                      <tr key={p.id}>
                        <td>{p.nombre}</td>
                        <td>{p.cargo || '-'}</td>
                        <td style={{ textAlign: 'center' }}>{p.contrato_horas || 0}</td>
                        <td style={{ textAlign: 'center', fontWeight: 'bold', color: 'var(--primary)' }}>
                          {Math.floor((p.horas_excedentes || 0) * 1.33)}
                        </td>
                        <td style={{ textAlign: 'center', fontWeight: 'bold', color: '#ef4444' }}>
                          {p.horas_no_lectivas || 0}
                        </td>
                        <td>{p.email}</td>
                        <td>{p.rol}</td>
                        <td>{p.activo ? 'Activo' : 'Inactivo'}</td>
                        <td className="table-actions">
                          <button 
                            className="btn-edit" 
                            onClick={() => openEditModal(p)}
                            disabled={processing}
                          >
                            Editar
                          </button>
                          <button 
                            className="btn-delete" 
                            onClick={() => handleDeleteProfessor(p.id, p.nombre)}
                            disabled={processing}
                          >
                            Eliminar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </>
        ) : activeTab === 'coberturas' ? (
          <section className="coverage-planner">
            <div className="planner-header">
              <h2>Planificación de Coberturas</h2>
              <p>Define reemplazos bloque por bloque para ausencias programadas o licencias.</p>
            </div>

            <div className="planner-controls">
              <div className="form-group">
                <label>Profesor Ausente</label>
                <select 
                  value={absentTeacherId} 
                  onChange={e => setAbsentTeacherId(e.target.value)}
                >
                  <option value="">Seleccionar profesor...</option>
                  {profesores.filter(p => p.rol === 'profesor').map(p => (
                    <option key={p.id} value={p.id}>{p.nombre}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Fecha de Ausencia</label>
                <input 
                  type="date" 
                  value={selectedDate} 
                  onChange={e => setSelectedDate(e.target.value)} 
                />
              </div>
              <button 
                className="btn-save" 
                onClick={handleSaveCoverages}
                disabled={processing || absentSchedule.length === 0}
              >
                {processing ? 'Guardando...' : 'Guardar Planificación'}
              </button>
            </div>

            <div className="planner-content">
              {plannerLoading ? (
                <p className="empty-state">Buscando horarios...</p>
              ) : absentTeacherId && absentSchedule.length > 0 ? (
                <div className="planner-blocks">
                  <h3>Horario de {profesores.find(p => p.id === absentTeacherId)?.nombre}</h3>
                  {absentSchedule.map(block => {
                    const available = getAvailableTeachers(block.hora_inicio)
                    return (
                      <div key={block.id} className="block-assignment-card">
                        <div className="block-info">
                          <span className="block-num">Bloque {BLOQUES.find(b => b.inicio.startsWith(block.hora_inicio.slice(0,5)))?.id || '?'}</span>
                          <span className="block-time">{block.hora_inicio.slice(0,5)} - {block.hora_fin.slice(0,5)}</span>
                        </div>
                        <div className="class-info">
                          <h4>{block.asignaturas?.nombre || 'Administrativo'}</h4>
                          <p>{block.curso || '-'}</p>
                        </div>
                        <div className="substitute-select">
                          <select 
                            value={assignments[block.id] || ''} 
                            onChange={e => setAssignments({...assignments, [block.id]: e.target.value})}
                          >
                            <option value="">Sin reemplazo</option>
                            {available.map(p => (
                              <option 
                                key={p.id} 
                                value={p.id}
                                style={{ color: p.isOverSurplus ? '#ef4444' : 'inherit' }}
                              >
                                {p.nombre} ({p.remaining} blq {p.isOverSurplus ? '⚠️ NO LECTIVAS' : 'disponibles'})
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : absentTeacherId ? (
                <div className="empty-state">
                  <p>No hay clases que cubrir para este profesor en este día.</p>
                </div>
              ) : (
                <div className="empty-state">
                  <p>Selecciona un profesor y una fecha para comenzar.</p>
                </div>
              )}
            </div>

            {plannedCoverages.length > 0 && (
              <div className="planned-list" style={{ marginTop: '3rem' }}>
                <h3>Planificaciones Recientes</h3>
                <div className="grid-wrapper">
                  <table style={{ background: 'var(--bg)', borderRadius: '1rem', border: '1px solid var(--border)' }}>
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Ausente</th>
                        <th>Reemplazo</th>
                        <th>Bloque</th>
                        <th>Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plannedCoverages.map(c => (
                        <tr key={c.id}>
                          <td>{new Date(c.fecha + 'T00:00:00').toLocaleDateString('es-ES')}</td>
                          <td>{c.ausente?.nombre}</td>
                          <td>{c.reemplazo?.nombre}</td>
                          <td>{BLOQUES.find(b => b.inicio.startsWith(c.horarios?.hora_inicio?.slice(0,5)))?.id}°</td>
                          <td>
                            <button className="btn-delete" onClick={() => handleDeleteCoverage(c.id)}>Eliminar</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        ) : activeTab === 'horarios' ? (
          <section className="horarios-section">
            <div className="planner-header">
              <h2>Gestión de Horarios Docentes</h2>
              <p>Visualiza y modifica la carga horaria semanal de cualquier profesor.</p>
            </div>

            <div className="planner-controls" style={{ background: 'var(--bg-soft)', padding: '1.5rem', borderRadius: '1.5rem', marginBottom: '2.5rem' }}>
              <div className="form-group" style={{ marginBottom: 0, maxWidth: '400px' }}>
                <label>Seleccionar Profesor</label>
                <select 
                  value={selectedTeacherId} 
                  onChange={e => setSelectedTeacherId(e.target.value)}
                >
                  <option value="">Seleccionar un profesor para editar...</option>
                  {profesores.map(p => (
                    <option key={p.id} value={p.id}>{p.nombre}</option>
                  ))}
                </select>
              </div>
              <div className="action-buttons" style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                <button 
                  className="secondary" 
                  onClick={handleExportIndividual}
                  disabled={!selectedTeacherId || processing}
                >
                  📥 Descargar Horario Actual (Excel)
                </button>
                <button 
                  className="secondary" 
                  onClick={handleExportAll}
                  disabled={processing}
                >
                  📚 Descargar Todos los Horarios (Excel)
                </button>
                <button 
                  className="secondary" 
                  style={{ background: '#f59e0b', color: 'white' }}
                  onClick={() => handleExportSpecialized('apoderado')}
                  disabled={processing}
                >
                  📋 Reporte Apoderados (Todos)
                </button>
                <button 
                  className="secondary" 
                  style={{ background: '#8b5cf6', color: 'white' }}
                  onClick={() => handleExportSpecialized('dupla')}
                  disabled={processing}
                >
                  👥 Reporte Duplas (Todos)
                </button>
              </div>
            </div>

            {selectedTeacherId ? (
              <div className="schedule-container">
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'flex-start',
                  marginBottom: '2rem',
                  padding: '1.5rem',
                  background: 'var(--bg-soft)',
                  borderRadius: '1.25rem',
                  border: '1px solid var(--border)'
                }}>
                  <div className="teacher-info-header">
                    <h3 style={{ margin: 0, fontSize: '1.4rem' }}>
                      Horario Semanal: {profesores.find(p => p.id === selectedTeacherId)?.nombre}
                    </h3>
                    <p style={{ margin: '0.4rem 0 0 0', opacity: 0.7 }}>
                      {profesores.find(p => p.id === selectedTeacherId)?.cargo} • {profesores.find(p => p.id === selectedTeacherId)?.email}
                    </p>
                  </div>
                  
                  {(() => {
                    const st = profesores.find(p => p.id === selectedTeacherId)
                    if (!st) return null
                    const budget = getDetailedBudget(st.horas_excedentes, st.horas_no_lectivas)
                    const surplusUsed = Math.min(totalCoverageUsage, budget.surplus)
                    const surplusRemaining = budget.surplus - surplusUsed
                    const nonTeachingUsed = Math.max(0, totalCoverageUsage - budget.surplus)
                    const overBudget = nonTeachingUsed > budget.noLectivas

                    return (
                      <div className="budget-mini-panel" style={{ display: 'flex', gap: '2rem' }}>
                        <div className="stat-mini">
                          <span style={{ fontSize: '0.8rem', opacity: 0.7, fontWeight: 600, display: 'block' }}>EXCEDENTES USADAS</span>
                          <span style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--accent)' }}>
                            {surplusUsed} / {budget.surplus} blq
                          </span>
                        </div>
                        <div className="stat-mini">
                          <span style={{ fontSize: '0.8rem', opacity: 0.7, fontWeight: 600, display: 'block' }}>NO LECTIVAS USADAS</span>
                          <span style={{ fontSize: '1.2rem', fontWeight: 800, color: overBudget ? '#ef4444' : 'var(--text)' }}>
                             {nonTeachingUsed} / {budget.noLectivas} blq
                          </span>
                        </div>
                        <div className="stat-mini">
                          <span style={{ fontSize: '0.8rem', opacity: 0.7, fontWeight: 600, display: 'block' }}>TOTAL CUBIERTO</span>
                          <span style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--accent)' }}>
                            {totalCoverageUsage} blq
                          </span>
                        </div>
                      </div>
                    )
                  })()}
                </div>

                <div className="schedule-header" style={{ marginTop: '1rem' }}>
                  <div className="legend">
                    <span className="legend-item class">Clase</span>
                    <span className="legend-item tc">TC</span>
                    <span className="legend-item dupla">Dupla</span>
                    <span className="legend-item apoderado">Apoderado</span>
                    <span className="legend-item available">Libre (Clic para añadir)</span>
                    <span className="legend-item inherited" style={{ background: '#fdf2f2', color: '#f97316', border: '1px solid #fecaca' }}>Reemplazo</span>
                  </div>
                </div>

                <div className="grid-wrapper">
                  <table className="schedule-grid">
                    <thead>
                      <tr>
                        <th>Bloque</th>
                        {DIAS.map(d => <th key={d.id}>{d.corto}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {BLOQUES.map(b => (
                        <tr key={b.id}>
                          <td className="time-col">
                            <span className="block-num">{b.id}°</span>
                            <span className="time-range">{b.inicio}-{b.fin}</span>
                          </td>
                          {DIAS.map(d => {
                            const item = getTeacherHorarioAt(d.id, b.inicio)
                            const type = item?.tipo_bloque?.trim().toLowerCase()
                            const isTC = type === 'tc'
                            const isDupla = type === 'dupla'
                            const isApoderado = type === 'apoderado'
                            const isClass = item && !isTC && !isDupla && !isApoderado
                            
                            return (
                              <td 
                                key={d.id} 
                                className={`slot ${isClass ? 'is-class' : isTC ? 'is-tc' : isDupla ? 'is-dupla' : isApoderado ? 'is-apoderado' : 'is-available'} ${item?.isInherited ? 'is-inherited' : ''}`}
                                onClick={() => !item?.isInherited && openScheduleModal(d.id, b.id, item)}
                                style={{ cursor: item?.isInherited ? 'default' : 'pointer' }}
                              >
                                {item ? (
                                  <div className="item-content">
                                    {item.isInherited && <span className="type-tag" style={{ background: '#f97316' }}>REEMPLAZO</span>}
                                    <span className="subject">
                                      {isTC ? 'TRABAJO COLAB.' : 
                                       isDupla ? 'DUPLA SICOSOCIAL' : 
                                       isApoderado ? 'ATENCIÓN APODERADO' : 
                                       item.asignaturas?.nombre || 'Administrativo'}
                                    </span>
                                    <span className="course">{item.curso} {item.isInherited && `(${item.ausenteNombre})`}</span>
                                  </div>
                                ) : (
                                  <span className="available-label" style={{ opacity: 0.3 }}>+</span>
                                )}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="empty-state">
                <p>Por favor, selecciona un profesor para gestionar su horario.</p>
              </div>
            )}
          </section>
        ) : (
          <section className="reemplazos-section">
            <div className="planner-header">
              <h2>Gestión de Reemplazos de Larga Duración</h2>
              <p>Registra docentes que cubrirán todas las clases de otro profesor por un periodo definido.</p>
            </div>

            <div className="planner-controls" style={{ background: 'var(--bg-soft)', padding: '2rem', borderRadius: '1.5rem', marginBottom: '2.5rem' }}>
              <form onSubmit={handleSaveReemplazo} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem', alignItems: 'flex-end' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Profesor Ausente</label>
                  <select 
                    required
                    value={newReemplazo.profesor_ausente_id} 
                    onChange={e => setNewReemplazo({...newReemplazo, profesor_ausente_id: e.target.value})}
                  >
                    <option value="">Seleccionar...</option>
                    {profesores.filter(p => p.rol === 'profesor').map(p => (
                      <option key={p.id} value={p.id}>{p.nombre}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Reemplazante</label>
                  <select 
                    required
                    value={newReemplazo.profesor_reemplazante_id} 
                    onChange={e => setNewReemplazo({...newReemplazo, profesor_reemplazante_id: e.target.value})}
                  >
                    <option value="">Seleccionar...</option>
                    {profesores.filter(p => p.rol === 'profesor' && p.id !== newReemplazo.profesor_ausente_id).map(p => (
                      <option key={p.id} value={p.id}>{p.nombre}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Fecha Inicio</label>
                  <input 
                    type="date" 
                    required
                    value={newReemplazo.fecha_inicio} 
                    onChange={e => setNewReemplazo({...newReemplazo, fecha_inicio: e.target.value})} 
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Fecha Término</label>
                  <input 
                    type="date" 
                    required
                    value={newReemplazo.fecha_fin} 
                    onChange={e => setNewReemplazo({...newReemplazo, fecha_fin: e.target.value})} 
                  />
                </div>
                <button type="submit" className="btn-save" style={{ height: 'fit-content' }} disabled={processing}>
                  {processing ? 'Guardando...' : 'Registrar Reemplazo'}
                </button>
              </form>
            </div>

            <div className="reemplazos-list">
              <h3>Historial de Reemplazos</h3>
              <div className="grid-wrapper">
                {reemplazos.length > 0 ? (
                  <table>
                    <thead>
                      <tr>
                        <th>Docente Ausente</th>
                        <th>Docente Reemplazante</th>
                        <th>Inicio</th>
                        <th>Término</th>
                        <th>Estado</th>
                        <th>Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reemplazos.map(r => {
                        const isExpired = new Date(r.fecha_fin) < new Date()
                        return (
                          <tr key={r.id}>
                            <td>{r.ausente?.nombre}</td>
                            <td>{r.reemplazo?.nombre}</td>
                            <td>{new Date(r.fecha_inicio + 'T00:00:00').toLocaleDateString('es-ES')}</td>
                            <td>{new Date(r.fecha_fin + 'T00:00:00').toLocaleDateString('es-ES')}</td>
                            <td style={{ color: isExpired ? '#ef4444' : '#10b981', fontWeight: 'bold' }}>
                              {isExpired ? 'Finalizado' : 'Vigente'}
                            </td>
                            <td>
                              <button className="btn-delete" onClick={() => handleDeleteReemplazo(r.id)}>Eliminar</button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                ) : (
                  <p className="empty-state">No hay reemplazos registrados.</p>
                )}
              </div>
            </div>
          </section>
        )}
      </main>
      {isScheduleModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content schedule-modal">
            <div className="modal-header">
              <h2>{editingBlock?.item ? 'Editar Bloque' : 'Añadir Bloque'}</h2>
              <button className="btn-close" onClick={() => setIsScheduleModalOpen(false)}>×</button>
            </div>
            
            <p className="modal-subtitle">
              {DIAS.find(d => d.id === newBlock.dia_semana)?.nombre} - Bloque {newBlock.bloque_id} ({BLOQUES.find(b => b.id === newBlock.bloque_id)?.inicio})
            </p>

            <form onSubmit={handleSaveBlock}>
              <div className="form-group">
                <label>Tipo de Bloque</label>
                <select 
                  value={newBlock.tipo_bloque} 
                  onChange={e => setNewBlock({...newBlock, tipo_bloque: e.target.value})}
                  required
                >
                  <option value="clase">Clase</option>
                  <option value="tc">Trabajo Colaborativo (TC)</option>
                  <option value="administrativo">Administrativo</option>
                  <option value="dupla">Dupla Sicosocial</option>
                  <option value="apoderado">Atención Apoderado</option>
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label>Día</label>
                  <select 
                    value={newBlock.dia_semana} 
                    onChange={e => setNewBlock({...newBlock, dia_semana: Number(e.target.value)})}
                  >
                    {DIAS.map(d => (
                      <option key={d.id} value={d.id}>{d.nombre}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Bloque</label>
                  <select 
                    value={newBlock.bloque_id} 
                    onChange={e => setNewBlock({...newBlock, bloque_id: Number(e.target.value)})}
                  >
                    {BLOQUES.map(b => (
                      <option key={b.id} value={b.id}>{b.id}° ({b.inicio}-{b.fin})</option>
                    ))}
                  </select>
                </div>
              </div>

              {['clase', 'administrativo'].includes(newBlock.tipo_bloque) && (
                <div className="form-group">
                  <label>Asignatura</label>
                  <select 
                    value={newBlock.asignatura_id} 
                    onChange={e => setNewBlock({...newBlock, asignatura_id: e.target.value})}
                    required
                  >
                    <option value="">Seleccionar asignatura...</option>
                    {asignaturas
                      .filter(a => ![ 'Dupla Sicosocial', 'Atención Apoderados', 'Atención Apoderado'].includes(a.nombre))
                      .map(a => (
                        <option key={a.id} value={a.id}>{a.nombre}</option>
                      ))}
                  </select>
                </div>
              )}

              {['clase', 'tc', 'administrativo', 'dupla', 'apoderado'].includes(newBlock.tipo_bloque) && (
                <div className="form-group">
                  <label>
                    {newBlock.tipo_bloque === 'clase' ? 'Curso' : 'Información Adicional (Con quién / Detalle)'}
                  </label>
                  <input 
                    type="text" 
                    value={newBlock.curso || ''} 
                    placeholder={newBlock.tipo_bloque === 'clase' ? "Ej: 1°A, 4°B..." : "Ej: Gladys A., Reunión UTP..."}
                    onChange={e => setNewBlock({...newBlock, curso: e.target.value})} 
                  />
                </div>
              )}

              <div className="modal-actions">
                {editingBlock?.item && (
                  <button 
                    type="button" 
                    className="btn-delete" 
                    onClick={handleDeleteBlock}
                    style={{ marginRight: 'auto' }}
                  >
                    Eliminar
                  </button>
                )}
                <button type="button" className="btn-cancel" onClick={() => setIsScheduleModalOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn-save" disabled={processing}>
                  {processing ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default AdminDashboard
