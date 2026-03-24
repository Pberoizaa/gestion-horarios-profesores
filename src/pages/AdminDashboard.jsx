import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import logo from '../assets/logo.jpg';
import { formatLongDate } from '../services/dateUtils';

// Modular Components
import ProfessorManager from '../components/admin/ProfessorManager';
import CoveragePlanner from '../components/admin/CoveragePlanner';
import LongTermReplacements from '../components/admin/LongTermReplacements';
import ScheduleEditor from '../components/admin/ScheduleEditor';
import ActivityMonitor from '../components/admin/ActivityMonitor';

function AdminDashboard() {
  const [activeTab, setActiveTab] = useState('profesores');
  const [profesores, setProfesores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [asignaturas, setAsignaturas] = useState([]);
  const [reemplazos, setReemplazos] = useState([]);
  const [activityLogs, setActivityLogs] = useState([]);
  const [plannedCoverages, setPlannedCoverages] = useState([]);
  const [activeCoverageDates, setActiveCoverageDates] = useState([]);
  const [allSchedules, setAllSchedules] = useState([]);
  const [todaySummary, setTodaySummary] = useState([]);
  const [processing, setProcessing] = useState(false);

  // Password Change State
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [passData, setPassData] = useState({ newPass: '', confirmPass: '' });

  useEffect(() => {
    fetchAllData();
  }, []);

  useEffect(() => {
    // Real-time Subscriptions
    const channel = supabase
      .channel('admin_dashboard_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'coberturas' }, () => fetchCoverageData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profesores' }, () => fetchProfesores())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reemplazos_periodos' }, () => fetchReemplazos())
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, []);

  const fetchAllData = async () => {
    setLoading(true);
    await Promise.all([
      fetchProfesores(),
      fetchAsignaturas(),
      fetchReemplazos(),
      fetchCoverageData(),
      fetchActivityLogs(),
      fetchAllSchedules()
    ]);
    setLoading(false);
  };

  const fetchProfesores = async () => {
    const { data } = await supabase.from('profesores').select('*').order('nombre');
    setProfesores(data || []);
  };

  const fetchAsignaturas = async () => {
    const { data } = await supabase.from('asignaturas').select('*').order('nombre');
    setAsignaturas(data || []);
  };

  const fetchReemplazos = async () => {
    const { data } = await supabase.from('reemplazos_periodos').select('*, ausente:profesores!profesor_ausente_id(nombre), reemplazo:profesores!profesor_reemplazante_id(nombre)').order('fecha_inicio', { ascending: false });
    setReemplazos(data || []);
  };

  const fetchCoverageData = async () => {
    const today = new Date().toISOString().split('T')[0];
    const [{ data: coverages }, { data: dates }, { data: todayCov }] = await Promise.all([
      supabase.from('coberturas').select('*, ausente:profesores!profesor_ausente_id(nombre), reemplazo:profesores!profesor_reemplazante_id(nombre), horarios(*)').eq('tipo', 'cobertura').order('fecha', { ascending: false }).limit(50),
      supabase.from('coberturas').select('fecha').eq('tipo', 'cobertura').neq('estado', 'cancelada'),
      supabase.from('coberturas').select('ausente:profesores!profesor_ausente_id(nombre), reemplazo:profesores!profesor_reemplazante_id(nombre)').eq('fecha', today).eq('tipo', 'cobertura').neq('estado', 'cancelada')
    ]);
    setPlannedCoverages(coverages || []);
    setActiveCoverageDates(Array.from(new Set((dates || []).map(d => d.fecha))));
    
    // Format unique today summary
    const summaryMap = new Map();
    (todayCov || []).forEach(c => {
      if (c.ausente && c.reemplazo) {
        summaryMap.set(c.ausente.nombre, c.reemplazo.nombre);
      }
    });
    setTodaySummary(Array.from(summaryMap.entries()).map(([ausente, reemplazo]) => `${ausente} (por ${reemplazo})`));
  };

  const fetchActivityLogs = async () => {
    const { data } = await supabase.from('actividad_usuarios').select('*, profes:profesores(nombre)').order('fecha', { ascending: false }).limit(200);
    setActivityLogs(data || []);
  };

  const fetchAllSchedules = async () => {
    const { data } = await supabase.from('horarios').select('*');
    setAllSchedules(data || []);
  };

  const handleUpdateOwnPassword = async (e) => {
    e.preventDefault();
    if (passData.newPass !== passData.confirmPass) return alert("Las contraseñas no coinciden");
    if (passData.newPass.length < 6) return alert("Mínimo 6 caracteres");

    setProcessing(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: passData.newPass });
      if (error) throw error;
      alert("Contraseña actualizada con éxito");
      setIsPasswordModalOpen(false);
      setPassData({ newPass: '', confirmPass: '' });
    } catch (err) {
      alert(err.message);
    } finally {
      setProcessing(false);
    }
  };

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
        <div className="header-actions" style={{ display: 'flex', gap: '0.75rem' }}>
          <button className="logout-button" onClick={() => setIsPasswordModalOpen(true)}>Cambiar Contraseña</button>
          <button className="logout-button" onClick={() => supabase.auth.signOut()}>Cerrar Sesión</button>
        </div>
      </header>

      <main>
        <section className="admin-tabs">
          <button className={`tab-button ${activeTab === 'profesores' ? 'active' : ''}`} onClick={() => setActiveTab('profesores')}>Profesores</button>
          <button className={`tab-button ${activeTab === 'coberturas' ? 'active' : ''}`} onClick={() => setActiveTab('coberturas')}>Coberturas</button>
          <button className={`tab-button ${activeTab === 'reemplazos' ? 'active' : ''}`} onClick={() => setActiveTab('reemplazos')}>Reemplazos</button>
          <button className={`tab-button ${activeTab === 'horarios' ? 'active' : ''}`} onClick={() => setActiveTab('horarios')}>Horarios</button>
          <button className={`tab-button ${activeTab === 'monitoreo' ? 'active' : ''}`} onClick={() => setActiveTab('monitoreo')}>Monitoreo</button>
        </section>

        <div className="tab-content">
          {activeTab === 'profesores' && (
            <ProfessorManager 
              supabase={supabase} 
              profesores={profesores} 
              loading={loading} 
              todaySummary={todaySummary}
              onRefresh={fetchProfesores} 
            />
          )}
          {activeTab === 'coberturas' && (
            <CoveragePlanner 
              supabase={supabase} 
              profesores={profesores} 
              allSchedules={allSchedules}
              plannedCoverages={plannedCoverages}
              activeCoverageDates={activeCoverageDates}
              onRefresh={fetchCoverageData}
            />
          )}
          {activeTab === 'reemplazos' && (
            <LongTermReplacements 
              supabase={supabase} 
              profesores={profesores} 
              reemplazos={reemplazos} 
              onRefresh={fetchReemplazos} 
            />
          )}
          {activeTab === 'horarios' && (
            <ScheduleEditor 
              supabase={supabase} 
              profesores={profesores} 
              asignaturas={asignaturas} 
            />
          )}
          {activeTab === 'monitoreo' && (
            <ActivityMonitor 
              activityLogs={activityLogs} 
              loading={loading} 
            />
          )}
        </div>
      </main>

      {isPasswordModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>Cambiar mi Contraseña</h3>
              <button className="btn-close" onClick={() => setIsPasswordModalOpen(false)}>Cerrar</button>
            </div>
            <form onSubmit={handleUpdateOwnPassword}>
              <div className="form-group">
                <label>Nueva Contraseña</label>
                <input type="password" required value={passData.newPass} onChange={e => setPassData({...passData, newPass: e.target.value})} />
              </div>
              <div className="form-group">
                <label>Confirmar Contraseña</label>
                <input type="password" required value={passData.confirmPass} onChange={e => setPassData({...passData, confirmPass: e.target.value})} />
              </div>
              <div className="modal-actions">
                <button type="submit" className="btn-save" disabled={processing}>{processing ? 'Actualizando...' : 'Actualizar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminDashboard;
