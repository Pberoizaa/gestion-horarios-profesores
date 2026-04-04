import React, { useState } from 'react';

const WeeklyHistory = ({ history, loading }) => {
  const [selectedWeek, setSelectedWeek] = useState(null);

  // Pre-calculate grouped data
  const grouped = React.useMemo(() => {
    return history.reduce((acc, curr) => {
      const key = `${curr.semana_inicio} - ${curr.semana_fin}`;
      if (!acc[key]) acc[key] = { 
        semana: key, 
        fecha: curr.created_at, 
        total: 0, 
        count: 0,
        profesores: []
      };
      acc[key].total += curr.total_bloques_semana;
      acc[key].count += 1;
      acc[key].profesores.push({
        nombre: curr.profesores?.nombre || 'Desconocido', 
        bloques: curr.total_bloques_semana
      });
      return acc;
    }, {});
  }, [history]);

  const historyList = Object.values(grouped).sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

  return (
    <div className="weekly-history" style={{ marginTop: '3rem' }}>
      <h3 style={{ marginBottom: '1rem' }}>Historial de Cierres Semanales</h3>
      {loading ? (
        <p>Cargando historial...</p>
      ) : historyList.length === 0 ? (
        <p style={{ opacity: 0.6 }}>No hay cierres de semana registrados aún.</p>
      ) : (
        <div className="grid-wrapper">
          <table className="responsive-table">
            <thead>
              <tr>
                <th>Semana</th>
                <th>Fecha Cierre</th>
                <th>Bloques Totales</th>
                <th>Profesores</th>
                <th style={{ textAlign: 'center' }}>Acción</th>
              </tr>
            </thead>
            <tbody>
              {historyList.map((week, i) => (
                <tr key={i}>
                  <td data-label="Semana" style={{ fontWeight: '600' }}>{week.semana}</td>
                  <td data-label="Cierre">
                    {new Date(week.fecha).toLocaleDateString('es-ES', { 
                      day: '2-digit', 
                      month: '2-digit', 
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </td>
                  <td data-label="Bloques" style={{ textAlign: 'center' }}>
                    <span className="badge info">{week.total} bloques</span>
                  </td>
                  <td data-label="Profesores" style={{ fontSize: '0.85rem', opacity: 0.8 }}>
                    {week.count} docentes procesados
                  </td>
                  <td data-label="Acción" style={{ textAlign: 'center' }}>
                    <button 
                      className="btn-edit" 
                      onClick={() => setSelectedWeek(week)}
                    >
                      Ver Detalle
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedWeek && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>Detalle de la Semana</h3>
              <button className="btn-close" onClick={() => setSelectedWeek(null)}>Cerrar</button>
            </div>
            <p className="modal-subtitle">Período: {selectedWeek.semana}</p>
            
            <table className="responsive-table" style={{ marginTop: '1rem' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Profesor</th>
                  <th style={{ textAlign: 'right' }}>Bloques Realizados</th>
                </tr>
              </thead>
              <tbody>
                {selectedWeek.profesores.sort((a,b) => b.bloques - a.bloques).map((p, i) => (
                  <tr key={i}>
                    <td data-label="Profesor" style={{ fontWeight: '600', textAlign: 'left' }}>{p.nombre}</td>
                    <td data-label="Bloques" style={{ textAlign: 'right', color: 'var(--accent)', fontWeight: 'bold' }}>
                      {p.bloques} blq
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="modal-actions" style={{ marginTop: '2rem' }}>
              <button className="btn-save" onClick={() => setSelectedWeek(null)}>Cerrar Visualización</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WeeklyHistory;
