import React, { useState } from 'react';

const LongTermReplacements = ({ supabase, profesores, reemplazos, onRefresh }) => {
  const [newReemplazo, setNewReemplazo] = useState({
    profesor_ausente_id: '',
    profesor_reemplazante_id: '',
    fecha_inicio: '',
    fecha_fin: '',
    motivo: ''
  });
  const [processing, setProcessing] = useState(false);

  const handleSaveReemplazo = async (e) => {
    e.preventDefault();
    setProcessing(true);
    try {
      // 1. Insert the replacement period
      const { data, error } = await supabase
        .from('reemplazos_periodos')
        .insert([newReemplazo])
        .select()
        .single();
      
      if (error) throw error;
      
      // 2. Fetch absent teacher's schedule to duplicate as coverages
      const { data: schedule, error: sError } = await supabase
        .from('horarios')
        .select('*')
        .eq('profesor_id', newReemplazo.profesor_ausente_id);
      
      if (sError) throw sError;

      // 3. Generate coverages for each day in range (limit to 60 days)
      const startDate = new Date(newReemplazo.fecha_inicio + 'T00:00:00');
      const endDate = new Date(newReemplazo.fecha_fin + 'T00:00:00');
      const coverages = [];
      let loopCount = 0;
      
      for (let d = new Date(startDate); d <= endDate && loopCount < 60; d.setDate(d.getDate() + 1)) {
        loopCount++;
        const dayNum = d.getDay(); // 0=Sun, 1=Mon...
        const dbDay = dayNum === 0 ? 7 : dayNum;
        if (dbDay > 5) continue; // Skip weekends

        const dateStr = d.toISOString().split('T')[0];
        const dayBlocks = schedule.filter(h => h.dia_semana === dbDay);
        
        for (const block of dayBlocks) {
          coverages.push({
            profesor_ausente_id: newReemplazo.profesor_ausente_id,
            profesor_reemplazante_id: newReemplazo.profesor_reemplazante_id,
            fecha: dateStr,
            horario_id: block.id,
            estado: 'pendiente',
            tipo: 'reemplazo'
          });
        }
      }

      if (coverages.length > 0) {
        const { error: cError } = await supabase.from('coberturas').insert(coverages);
        if (cError) throw cError;
      }

      alert(`Reemplazo registrado. Se han cargado ${coverages.length} bloques.`);
      setNewReemplazo({ profesor_ausente_id: '', profesor_reemplazante_id: '', fecha_inicio: '', fecha_fin: '', motivo: '' });
      onRefresh();
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleDeleteReemplazo = async (id) => {
    if (!confirm('¿Eliminar este registro?')) return;
    try {
      const { error } = await supabase.from('reemplazos_periodos').delete().eq('id', id);
      if (error) throw error;
      onRefresh();
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <section className="reemplazos-section">
      <div className="planner-header">
        <h2>Gestión de Reemplazos de Larga Duración</h2>
        <p>Registra docentes que cubrirán todas las clases de otro profesor por un periodo definido.</p>
      </div>

      <div className="planner-controls" style={{ background: 'var(--bg-soft)', padding: '2rem', borderRadius: '1.5rem', marginBottom: '2.5rem' }}>
        <form onSubmit={handleSaveReemplazo} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem', alignItems: 'flex-end' }}>
          <div className="form-group">
            <label>Profesor Ausente</label>
            <select required value={newReemplazo.profesor_ausente_id} onChange={e => setNewReemplazo({...newReemplazo, profesor_ausente_id: e.target.value})}>
              <option value="">Seleccionar...</option>
              {profesores.filter(p => p.rol === 'profesor').map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Reemplazante</label>
            <select required value={newReemplazo.profesor_reemplazante_id} onChange={e => setNewReemplazo({...newReemplazo, profesor_reemplazante_id: e.target.value})}>
              <option value="">Seleccionar...</option>
              {profesores.filter(p => p.rol === 'profesor' && p.id !== newReemplazo.profesor_ausente_id).map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Fecha Inicio</label>
            <input type="date" required value={newReemplazo.fecha_inicio} onChange={e => setNewReemplazo({...newReemplazo, fecha_inicio: e.target.value})} />
          </div>
          <div className="form-group">
            <label>Fecha Término</label>
            <input type="date" required value={newReemplazo.fecha_fin} onChange={e => setNewReemplazo({...newReemplazo, fecha_fin: e.target.value})} />
          </div>
          <button type="submit" className="btn-save" style={{ height: 'fit-content' }} disabled={processing}>
            {processing ? 'Guardando...' : 'Registrar Reemplazo'}
          </button>
        </form>
      </div>

      <div className="reemplazos-list">
        <h3>Historial de Reemplazos</h3>
        <table className="responsive-table">
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
              const isExpired = new Date(r.fecha_fin) < new Date();
              return (
                <tr key={r.id}>
                  <td data-label="Ausente">{r.ausente?.nombre}</td>
                  <td data-label="Reemplazante">{r.reemplazo?.nombre}</td>
                  <td data-label="Inicio">{new Date(r.fecha_inicio + 'T00:00:00').toLocaleDateString('es-ES')}</td>
                  <td data-label="Término">{new Date(r.fecha_fin + 'T00:00:00').toLocaleDateString('es-ES')}</td>
                  <td data-label="Estado" style={{ color: isExpired ? '#ef4444' : '#10b981', fontWeight: 'bold' }}>
                    {isExpired ? 'Finalizado' : 'Vigente'}
                  </td>
                  <td>
                    <button className="btn-delete" onClick={() => handleDeleteReemplazo(r.id)}>Eliminar</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
};

export default LongTermReplacements;
