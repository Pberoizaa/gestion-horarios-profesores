import React from 'react';

const ActivityMonitor = ({ activityLogs, loading }) => {
  return (
    <section className="monitoreo-section">
      <div className="planner-header">
        <h2>Monitoreo de Actividad</h2>
        <p>Seguimiento de accesos y acciones realizadas por los profesores.</p>
      </div>
      
      <div className="activity-list" style={{ marginTop: '2rem' }}>
        {loading ? (
          <p>Cargando registros...</p>
        ) : activityLogs.length === 0 ? (
          <div className="empty-state">
            <p>No hay actividad registrada aún.</p>
          </div>
        ) : (
          <div style={{ maxHeight: '420px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '8px' }}>
            <table className="responsive-table" style={{ marginTop: 0 }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--card-bg)', zIndex: 1 }}>
                <tr>
                  <th>Fecha y Hora</th>
                  <th>Profesor</th>
                  <th>Acción</th>
                  <th>Dispositivo / Detalles</th>
                </tr>
              </thead>
              <tbody>
                {activityLogs.map(log => (
                  <tr key={log.id}>
                    <td data-label="Fecha">
                      {new Date(log.fecha).toLocaleString('es-ES', { 
                        day: '2-digit', 
                        month: '2-digit', 
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </td>
                    <td data-label="Profesor" style={{ fontWeight: '500' }}>
                      {log.profes?.nombre || 'Desconocido'}
                    </td>
                    <td data-label="Acción">
                      <span className={`badge ${log.accion === 'ingreso_plataforma' ? 'success' : 'info'}`}>
                        {log.accion === 'ingreso_plataforma' ? 'Inicio Sesión' : log.accion}
                      </span>
                    </td>
                    <td data-label="Detalles" style={{ fontSize: '0.85rem', opacity: 0.8 }}>
                      {log.detalles?.userAgent?.includes('Mobi') ? '📱 Móvil' : '💻 Escritorio'}
                      <small style={{ display: 'block', opacity: 0.6 }}>
                        {log.detalles?.userAgent?.split(') ')[0]?.split('(')[1] || ''}
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
};

export default ActivityMonitor;
