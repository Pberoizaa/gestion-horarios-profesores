import { useState, useEffect } from 'react'
import { supabase } from '../services/supabase'
import AdminDashboard from './AdminDashboard'
import TeacherDashboard from './TeacherDashboard'

function Dashboard() {
  const [role, setRole] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        window.location.href = '/'
        return
      }

      // Wait for the session to be available before querying the DB
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        if (!session?.user) {
          window.location.href = '/'
          return
        }
        await fetchUserRole(session.user)
      }
    })

    return () => { subscription.unsubscribe() }
  }, [])

  async function fetchUserRole(user) {
    try {
      const { data: profile, error } = await supabase
        .from('profesores')
        .select('rol')
        .eq('email', user.email)
        .single()
      
      if (error) throw error
      setRole(profile.rol)
    } catch (error) {
      console.error('Error fetching role:', error.message)
      window.location.href = '/'
    } finally {
      setLoading(false)
    }
  }

  if (loading) return (
    <div style={{ 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center', 
      minHeight: '100vh',
      flexDirection: 'column',
      gap: '1rem',
      opacity: 0.6,
      fontSize: '1rem'
    }}>
      <div style={{ fontSize: '2rem' }}>⏳</div>
      Cargando...
    </div>
  )

  return (
    <>
      {role === 'admin' ? (
        <AdminDashboard />
      ) : (
        <TeacherDashboard />
      )}
    </>
  )
}

export default Dashboard
