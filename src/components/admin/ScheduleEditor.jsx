import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { BLOQUES, DIAS } from '../../services/constants';
import { getWeekRange } from '../../services/dateUtils';
import { getDetailedBudget } from '../../services/budgetUtils';

const ScheduleEditor = ({ supabase, profesores, asignaturas }) => {
  const [selectedTeacherId, setSelectedTeacherId] = useState('');
  const [teacherSchedule, setTeacherSchedule] = useState([]);
  const [teacherCoverages, setTeacherCoverages] = useState([]);
  const [totalCoverageUsage, setTotalCoverageUsage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);
  const [editingBlock, setEditingBlock] = useState(null);
  const [newBlock, setNewBlock] = useState({
    asignatura_id: '',
    tipo_bloque: 'clase',
    curso: '',
    dia_semana: 1,
    bloque_id: 1
  });

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (selectedTeacherId) {
      fetchTeacherSchedule();
    }
  }, [selectedTeacherId]);

  async function fetchTeacherSchedule() {
    setLoading(true);
    try {
      const { data: schedule, error: sError } = await supabase
        .from('horarios')
        .select('*, asignaturas(nombre)')
        .eq('profesor_id', selectedTeacherId);
      
      if (sError) throw sError;
      setTeacherSchedule(schedule || []);

      const { start, end } = getWeekRange(new Date().toISOString().split('T')[0]);
      const { data: coverages, error: cError } = await supabase
        .from('coberturas')
        .select('*, ausente:profesores!profesor_ausente_id(nombre), horarios(*, asignaturas(nombre))')
        .eq('profesor_reemplazante_id', selectedTeacherId)
        .gte('fecha', start)
        .lte('fecha', end)
        .neq('estado', 'cancelada');
      
      if (cError) throw cError;
      setTeacherCoverages(coverages || []);

      const { count, error: countError } = await supabase
        .from('coberturas')
        .select('*', { count: 'exact', head: true })
        .eq('profesor_reemplazante_id', selectedTeacherId)
        .neq('estado', 'cancelada');
      
      if (countError) throw countError;
      setTotalCoverageUsage(count || 0);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const getTeacherHorarioAt = (diaId, horaInicio) => {
    const own = teacherSchedule.find(h => h.dia_semana === diaId && h.hora_inicio.slice(0, 5) === horaInicio.slice(0, 5));
    if (own) return own;

    const coverage = teacherCoverages.find(c => {
      const cDate = new Date(c.fecha + 'T00:00:00');
      const cDay = cDate.getDay() || 7;
      return cDay === diaId && c.horarios?.hora_inicio?.slice(0, 5) === horaInicio.slice(0, 5);
    });

    if (coverage) {
      return {
        ...coverage.horarios,
        tipo: coverage.tipo,
        isInherited: true,
        ausenteNombre: coverage.ausente?.nombre
      };
    }
    return null;
  };

  const handleSaveBlock = async (e) => {
    e.preventDefault();
    setProcessing(true);
    try {
      const targetBlock = BLOQUES.find(b => b.id === Number(newBlock.bloque_id));
      const payload = {
        profesor_id: selectedTeacherId,
        asignatura_id: ['clase', 'administrativo'].includes(newBlock.tipo_bloque) ? newBlock.asignatura_id : null,
        tipo_bloque: newBlock.tipo_bloque,
        curso: newBlock.curso || null,
        dia_semana: Number(newBlock.dia_semana),
        hora_inicio: targetBlock.inicio,
        hora_fin: targetBlock.fin
      };

      if (editingBlock?.item) {
        const { error } = await supabase.from('horarios').update(payload).eq('id', editingBlock.item.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('horarios').insert([payload]);
        if (error) throw error;
      }

      alert('Bloque guardado');
      setIsModalOpen(false);
      fetchTeacherSchedule();
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleDeleteBlock = async () => {
    if (!confirm('¿Eliminar bloque?')) return;
    setProcessing(true);
    try {
      const { error } = await supabase.from('horarios').delete().eq('id', editingBlock.item.id);
      if (error) throw error;
      setIsModalOpen(false);
      fetchTeacherSchedule();
    } catch (err) {
      alert(err.message);
    } finally {
      setProcessing(false);
    }
  };

  const exportToExcel = (prof, schedule) => {
    const headers = ["Bloque", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes"];
    const rows = BLOQUES.map(b => {
      const row = [`${b.id}° (${b.inicio})`];
      DIAS.forEach(d => {
        const item = schedule.find(h => h.dia_semana === d.id && h.hora_inicio.slice(0,5) === b.inicio.slice(0,5));
        row.push(item ? `${item.asignaturas?.nombre || item.tipo_bloque}${item.curso ? ` (${item.curso})` : ''}` : '');
      });
      return row;
    });
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Horario");
    XLSX.writeFile(wb, `Horario_${prof.nombre}.xlsx`);
  };

  const handleExportAll = async () => {
    setProcessing(true);
    try {
      const { data: allSchedules, error } = await supabase.from('horarios').select('*, asignaturas(nombre)');
      if (error) throw error;
      const wb = XLSX.utils.book_new();
      profesores.forEach(p => {
        const pSchedule = allSchedules.filter(s => s.profesor_id === p.id);
        if (pSchedule.length > 0) {
          const headers = ["Bloque", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes"];
          const rows = BLOQUES.map(b => {
            const row = [`${b.id}°`];
            DIAS.forEach(d => {
              const item = pSchedule.find(h => h.dia_semana === d.id && h.hora_inicio.slice(0,5) === b.inicio.slice(0,5));
              row.push(item ? `${item.asignaturas?.nombre || item.tipo_bloque}${item.curso ? ` (${item.curso})` : ''}` : '');
            });
            return row;
          });
          XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...rows]), p.nombre.substring(0,31));
        }
      });
      XLSX.writeFile(wb, "Horarios_Completos.xlsx");
    } catch (err) {
      alert(err.message);
    } finally {
      setProcessing(false);
    }
  };

  const openEditModal = (dia, bloque, item) => {
    setEditingBlock({ dia, bloque, item });
    setNewBlock({
      asignatura_id: item?.asignatura_id || '',
      tipo_bloque: item?.tipo_bloque || 'clase',
      curso: item?.curso || '',
      dia_semana: dia,
      bloque_id: bloque
    });
    setIsModalOpen(true);
  };

  return (
    <section className="horarios-section">
      <div className="planner-header">
        <h2>Gestión de Horarios Docentes</h2>
        <p>Visualiza y modifica la carga horaria semanal de cualquier profesor.</p>
      </div>

      <div className="planner-controls" style={{ background: 'var(--bg-soft)', padding: '1.5rem', borderRadius: '1.5rem', marginBottom: '2.5rem' }}>
        <div className="form-group" style={{ maxWidth: '400px' }}>
          <label>Seleccionar Profesor</label>
          <div className="searchable-dropdown" ref={dropdownRef}>
            <div className="search-bar">
              <input 
                type="text" 
                placeholder="Escribe para buscar profesor..." 
                value={searchTerm || (profesores.find(p => p.id === selectedTeacherId)?.nombre || '')}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setIsOpen(true);
                  if (!e.target.value) setSelectedTeacherId('');
                }}
                onFocus={() => setIsOpen(true)}
                style={{ paddingLeft: '3.5rem' }}
              />
            </div>
            
            {isOpen && (
              <div className="dropdown-results">
                {profesores
                  .filter(p => !searchTerm || p.nombre.toLowerCase().includes(searchTerm.toLowerCase()))
                  .map(p => (
                    <div 
                      key={p.id} 
                      className="dropdown-item"
                      onClick={() => {
                        setSelectedTeacherId(p.id);
                        setSearchTerm(p.nombre);
                        setIsOpen(false);
                      }}
                    >
                      {p.nombre}
                    </div>
                  ))
                }
                {profesores.filter(p => !searchTerm || p.nombre.toLowerCase().includes(searchTerm.toLowerCase())).length === 0 && (
                  <div className="dropdown-item no-results">No se encontraron profesores</div>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="action-buttons" style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
          <button className="secondary" onClick={() => exportToExcel(profesores.find(p => p.id === selectedTeacherId), teacherSchedule)} disabled={!selectedTeacherId}>
            📥 Descargar Horario Actual
          </button>
          <button className="secondary" onClick={handleExportAll}>
            📚 Descargar Todos
          </button>
        </div>
      </div>

      {selectedTeacherId && (
        <div className="schedule-container">
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
                      <span className="time-range">{b.inicio}</span>
                    </td>
                    {DIAS.map(d => {
                      const item = getTeacherHorarioAt(d.id, b.inicio);
                      const isFridayEnd = d.id === 5 && b.id > 6;
                      return (
                        <td 
                          key={d.id} 
                          className={`slot ${isFridayEnd ? 'is-disabled' : item ? 'is-class' : 'is-available'} ${item?.isInherited ? 'is-inherited' : ''}`}
                          onClick={() => !isFridayEnd && !item?.isInherited && openEditModal(d.id, b.id, item)}
                        >
                          {item ? (
                            <div className="item-content">
                              <span className="subject">{item.asignaturas?.nombre || item.tipo_bloque}</span>
                              {item.curso && <span className="course">{item.curso}</span>}
                            </div>
                          ) : !isFridayEnd && <span className="available-label">+</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>{editingBlock.item ? 'Editar' : 'Añadir'} Bloque</h3>
              <button className="btn-close" onClick={() => setIsModalOpen(false)}>Cerrar</button>
            </div>
            <form onSubmit={handleSaveBlock}>
              <div className="form-group">
                <label>Tipo</label>
                <select value={newBlock.tipo_bloque} onChange={e => setNewBlock({...newBlock, tipo_bloque: e.target.value})}>
                  <option value="clase">Clase</option>
                  <option value="tc">TC</option>
                  <option value="administrativo">Administrativo</option>
                  <option value="bloqueado">Bloqueado</option>
                </select>
              </div>
              {['clase', 'administrativo'].includes(newBlock.tipo_bloque) && (
                <div className="form-group">
                  <label>Asignatura</label>
                  <select value={newBlock.asignatura_id} onChange={e => setNewBlock({...newBlock, asignatura_id: e.target.value})} required>
                    <option value="">Seleccionar...</option>
                    {asignaturas.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                  </select>
                </div>
              )}
              <div className="form-group">
                <label>Curso / Detalle</label>
                <input type="text" value={newBlock.curso || ''} onChange={e => setNewBlock({...newBlock, curso: e.target.value})} />
              </div>
              <div className="modal-actions">
                {editingBlock.item && <button type="button" className="btn-delete" onClick={handleDeleteBlock}>Eliminar</button>}
                <button type="submit" className="btn-save" disabled={processing}>{processing ? '...' : 'Guardar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
};

export default ScheduleEditor;
