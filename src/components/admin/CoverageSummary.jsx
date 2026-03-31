import React, { useState } from 'react';

const CoverageSummary = ({ coverages, profesores, loading }) => {
  const [sortBy, setSortBy] = useState('total');

  // Build summary per replacement teacher
  const summary = profesores
    .filter(p => p.activo && p.rol === 'profesor')
    .map(prof => {
      const assigned = coverages.filter(
        c => c.profesor_reemplazante_id === prof.id && c.estado !== 'cancelada'
      );
      const semana = assigned.filter(c => !c.contabilizada).length;
      const total = assigned.length;
      const presupuesto = parseFloat(prof.horas_excedentes || 0) + parseFloat(prof.horas_no_lectivas || 0);
      const uso = total * 0.75; // each block ≈ 0.75 hrs
      const pct = presupuesto > 0 ? Math.min((uso / presupuesto) * 100, 100) : 0;
      return { nombre: prof.nombre, semana, total, presupuesto, uso, pct };
    })
    .filter(p => p.total > 0)
    .sort((a, b) => sortBy === 'semana' ? b.semana - a.semana : b.total - a.total);

  const getBadgeColor = (pct) => {
    if (pct >= 90) return '#ef4444';
    if (pct >= 60) return '#f59e0b';
    return '#22c55e';
  };

  return (
    <section style={{ marginBottom: '2rem' }}>
      <div className="planner-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <h2>Resumen de Coberturas por Profesor</h2>
          <p>Total de reemplazos asignados a cada docente y uso de su presupuesto de horas.</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={() => setSortBy('semana')}
            className={`tab-button ${sortBy === 'semana' ? 'active' : ''}`}
            style={{ fontSize: '0.8rem', padding: '0.3rem 0.75rem' }}
          >
            Esta semana
          </button>
          <button
            onClick={() => setSortBy('total')}
            className={`tab-button ${sortBy === 'total' ? 'active' : ''}`}
            style={{ fontSize: '0.8rem', padding: '0.3rem 0.75rem' }}
          >
            Total histórico
          </button>
        </div>
      </div>

      <div style={{ marginTop: '1rem' }}>
        {loading ? (
          <p>Cargando datos...</p>
        ) : summary.length === 0 ? (
          <div className="empty-state"><p>No hay coberturas asignadas aún.</p></div>
        ) : (
          <div className="grid-wrapper">
            <table className="responsive-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Profesor</th>
                  <th style={{ textAlign: 'center' }}>Esta semana</th>
                  <th style={{ textAlign: 'center' }}>Total</th>
                  <th>Uso de presupuesto</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((prof, i) => (
                  <tr key={prof.nombre}>
                    <td style={{ fontWeight: '700', opacity: 0.5, width: '2rem' }}>
                      {i + 1}
                    </td>
                    <td style={{ fontWeight: '600' }}>{prof.nombre}</td>
                    <td data-label="Esta semana" style={{ textAlign: 'center' }}>
                      <span className="badge info">{prof.semana}</span>
                    </td>
                    <td data-label="Total" style={{ textAlign: 'center' }}>
                      <span className="badge success">{prof.total}</span>
                    </td>
                    <td data-label="Presupuesto" style={{ minWidth: '160px' }}>
                      {prof.presupuesto > 0 ? (
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: '3px' }}>
                            <span style={{ opacity: 0.7 }}>
                              ~{prof.uso.toFixed(1)}h de {prof.presupuesto}h
                            </span>
                            <span style={{ fontWeight: '600', color: getBadgeColor(prof.pct) }}>
                              {Math.round(prof.pct)}%
                            </span>
                          </div>
                          <div style={{ background: 'var(--border)', borderRadius: '4px', height: '6px', overflow: 'hidden' }}>
                            <div style={{
                              width: `${prof.pct}%`,
                              height: '100%',
                              background: getBadgeColor(prof.pct),
                              borderRadius: '4px',
                              transition: 'width 0.4s ease'
                            }} />
                          </div>
                        </div>
                      ) : (
                        <span style={{ opacity: 0.4, fontSize: '0.8rem' }}>Sin presupuesto</span>
                      )}
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

export default CoverageSummary;
