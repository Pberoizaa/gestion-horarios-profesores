import React, { useState, useEffect } from 'react';
import { BLOQUES, DIAS } from '../../services/constants';
import { getWeekRange, formatLongDate } from '../../services/dateUtils';
import { getDetailedBudget } from '../../services/budgetUtils';
import { MiniCalendar } from '../MiniCalendar';
import * as XLSX from 'xlsx';

const CoveragePlanner = ({ 
  supabase, 
  profesores, 
  allSchedules, 
  plannedCoverages, 
  activeCoverageDates,
  onRefresh
}) => {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [absentTeacherId, setAbsentTeacherId] = useState('');
  const [absentSchedule, setAbsentSchedule] = useState([]);
  const [assignments, setAssignments] = useState({});
  const [processing, setProcessing] = useState(false);
  const [plannerLoading, setPlannerLoading] = useState(false);
  const [isSummaryModalOpen, setIsSummaryModalOpen] = useState(false);
  const [summaryCoverages, setSummaryCoverages] = useState([]);

  useEffect(() => {
    if (absentTeacherId) {
      fetchAbsentTeacherSchedule();
    }
  }, [absentTeacherId, selectedDate]);

  async function fetchAbsentTeacherSchedule() {
    setPlannerLoading(true);
    try {
      const dateObj = new Date(selectedDate + 'T00:00:00');
      const diaSemana = dateObj.getDay() || 7; // Convert 0 (Sun) to 7 if needed, but handled below
      
      if (diaSemana === 0 || diaSemana === 6) {
        setAbsentSchedule([]);
        return;
      }

      const { data: schedule, error } = await supabase
        .from('horarios')
        .select('*, asignaturas(nombre)')
        .eq('profesor_id', absentTeacherId)
        .eq('dia_semana', diaSemana)
        .order('hora_inicio');
      
      if (error) throw error;

      // Filter logic (Friday 6 blocks, no block 10, etc.)
      const filtered = (schedule || []).filter(s => {
        const block = BLOQUES.find(b => b.inicio.startsWith(s.hora_inicio.slice(0,5)));
        if (!block) return false;
        if (diaSemana === 5 && block.id > 6) return false;
        if (block.id === 10) return false;
        return true;
      });

      setAbsentSchedule(filtered);
      setAssignments({});
    } catch (err) {
      console.error(err);
    } finally {
      setPlannerLoading(false);
    }
  }

  const getAvailableTeachers = (horaInicio) => {
    const busyIds = allSchedules
      .filter(s => {
        const d = DIAS.find(day => day.id === s.dia_semana);
        const selectedDayShort = new Date(selectedDate + 'T00:00:00').toLocaleDateString('es-ES', {weekday: 'short'}).toUpperCase().slice(0,2);
        return d?.corto === selectedDayShort && s.hora_inicio === horaInicio;
      })
      .map(s => s.profesor_id);

    return profesores
      .filter(p => p.activo && p.rol === 'profesor' && !busyIds.includes(p.id))
      .map(p => {
        const { start, end } = getWeekRange(selectedDate);
        const weekCount = plannedCoverages.filter(c => 
          c.profesor_reemplazante_id === p.id && 
          c.estado !== 'cancelada' &&
          c.fecha >= start && 
          c.fecha <= end
        ).length;

        const budget = getDetailedBudget(p.horas_excedentes, p.horas_no_lectivas);
        const remaining = budget.total - weekCount;
        return { ...p, weekCount, budget, remaining, isOverSurplus: weekCount >= budget.surplus };
      });
  };

  const handleSaveCoverages = async () => {
    const entries = [];
    const overBudget = [];

    for (const [horarioId, subId] of Object.entries(assignments)) {
      if (!subId) continue;
      const teacher = getAvailableTeachers('').find(p => p.id === subId);
      if (teacher && teacher.remaining < 1) overBudget.push(teacher.nombre);

      entries.push({
        profesor_ausente_id: absentTeacherId,
        profesor_reemplazante_id: subId,
        fecha: selectedDate,
        horario_id: horarioId,
        estado: 'pendiente',
        tipo: 'cobertura'
      });
    }

    if (overBudget.length > 0) {
      if (!confirm(`Advertencia: ${overBudget.join(', ')} superarán su presupuesto semanal. ¿Continuar?`)) return;
    }

    if (entries.length === 0) return alert('No hay asignaciones.');

    setProcessing(true);
    try {
      const ids = entries.map(e => e.horario_id);
      await supabase.from('coberturas').delete().eq('fecha', selectedDate).eq('profesor_ausente_id', absentTeacherId).in('horario_id', ids);
      const { error } = await supabase.from('coberturas').insert(entries);
      if (error) throw error;
      
      alert('Planificación guardada');
      setAssignments({});
      onRefresh(); // Refresh parent lists
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      setProcessing(false);
    }
  };

  const fetchDailySummary = async () => {
    setProcessing(true);
    try {
      const { data, error } = await supabase
        .from('coberturas')
        .select('*, ausente:profesores!profesor_ausente_id(nombre), reemplazo:profesores!profesor_reemplazante_id(nombre), horarios(*, asignaturas(nombre))')
        .eq('fecha', selectedDate)
        .eq('tipo', 'cobertura')
        .neq('estado', 'cancelada');
      
      if (error) throw error;
      setSummaryCoverages((data || []).sort((a,b) => (a.horarios?.bloque_id || 0) - (b.horarios?.bloque_id || 0)));
      setIsSummaryModalOpen(true);
    } catch (err) {
      alert(err.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleDeleteCoverage = async (cov) => {
    if (!confirm('¿Eliminar esta cobertura?')) return;
    try {
      const { error } = await supabase.from('coberturas').delete().eq('id', cov.id);
      if (error) throw error;
      setSummaryCoverages(prev => prev.filter(c => c.id !== cov.id));
      onRefresh();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDownloadExcel = () => {
    const data = summaryCoverages.map(cov => ({
      'Bloque': `${cov.horarios?.bloque_id}°`,
      'Ausente': cov.ausente?.nombre,
      'Reemplazo': cov.reemplazo?.nombre,
      'Asignatura': cov.horarios?.asignaturas?.nombre || 'Administrativo',
      'Curso': cov.curso || '-'
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Coberturas");
    XLSX.writeFile(wb, `Coberturas_${selectedDate}.xlsx`);
  };

  return (
    <section className="coverage-planner">
      <div className="planner-header">
        <h2>Planificación de Coberturas</h2>
        <p>Define reemplazos bloque por bloque para ausencias programadas o licencias.</p>
      </div>

      <div className="planner-layout">
        <aside className="planner-sidebar">
          <MiniCalendar 
            selectedDate={selectedDate}
            onDateSelect={setSelectedDate}
            activeDates={activeCoverageDates}
          />
          <div className="stat-card" style={{ width: '100%', marginTop: '1rem' }}>
            <h3>Resumen del Día</h3>
            <button className="btn-save" style={{ width: '100%', marginTop: '0.5rem' }} onClick={fetchDailySummary}>
              Ver Coberturas del Día
            </button>
          </div>
        </aside>

        <main className="planner-main">
          <div className="planner-controls">
            <div className="form-group">
              <label>Profesor Ausente</label>
              <select value={absentTeacherId} onChange={e => setAbsentTeacherId(e.target.value)}>
                <option value="">Seleccionar profesor...</option>
                {profesores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Fecha</label>
              <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} />
            </div>
            <button className="btn-save" onClick={handleSaveCoverages} disabled={processing || !absentTeacherId || absentSchedule.length === 0}>
              {processing ? 'Guardando...' : 'Guardar Planificación'}
            </button>
          </div>

          <div className="planner-content" style={{ marginTop: '2rem' }}>
            {plannerLoading ? (
              <p>Cargando disponibilidad...</p>
            ) : absentTeacherId && absentSchedule.length > 0 ? (
              <div className="planner-blocks">
                {absentSchedule.map(block => {
                  const available = getAvailableTeachers(block.hora_inicio);
                  return (
                    <div key={block.id} className="block-assignment-card">
                      <div className="block-info">
                        <span className="block-num">Bloque {BLOQUES.find(b => b.inicio.startsWith(block.hora_inicio.slice(0,5)))?.id}</span>
                        <span className="block-time">{block.hora_inicio.slice(0,5)}</span>
                      </div>
                      <div className="class-info">
                        <h4>{block.asignaturas?.nombre || 'Administrativo'}</h4>
                        <p>{block.curso || '-'}</p>
                      </div>
                      <select 
                        value={assignments[block.id] || ''} 
                        onChange={e => setAssignments({...assignments, [block.id]: e.target.value})}
                      >
                        <option value="">Sin reemplazo</option>
                        {available.map(p => (
                          <option key={p.id} value={p.id} style={{ color: p.isOverSurplus ? 'red' : 'inherit' }}>
                            {p.nombre} ({p.remaining} blq)
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="empty-state">
                <p>{absentTeacherId ? 'No hay clases para cubrir este día.' : 'Selecciona un profesor y fecha.'}</p>
              </div>
            )}
          </div>
        </main>
      </div>

      {isSummaryModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '800px' }}>
            <div className="modal-header">
              <h3>Coberturas para {selectedDate}</h3>
              <button className="btn-close" onClick={() => setIsSummaryModalOpen(false)}>Cerrar</button>
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <button className="btn-edit" onClick={handleDownloadExcel} disabled={summaryCoverages.length === 0}>
                Descargar Excel
              </button>
            </div>
            <table className="responsive-table">
              <thead>
                <tr>
                  <th>Bloque</th>
                  <th>Ausente</th>
                  <th>Reemplazo</th>
                  <th>Asignatura</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {summaryCoverages.map(c => (
                  <tr key={c.id}>
                    <td>{c.horarios?.bloque_id}°</td>
                    <td>{c.ausente?.nombre}</td>
                    <td>{c.reemplazo?.nombre}</td>
                    <td>{c.horarios?.asignaturas?.nombre}</td>
                    <td>
                      <button className="btn-delete" onClick={() => handleDeleteCoverage(c)}>Eliminar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
};

export default CoveragePlanner;
