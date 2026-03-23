import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../services/supabase'
import AdminDashboard from './AdminDashboard'
import TeacherDashboard from './TeacherDashboard'

function Dashboard() {
  const [role, setRole] = useState(null)
  const [loading, setLoading] = useState(true)
  const [sessionUser, setSessionUser] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    // Initial session check
    const checkSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.user) {
          navigate('/')
          return
        }
        setSessionUser(session.user)
        await fetchUserRole(session.user)
      } catch (err) {
        console.error('Session check error:', err)
        navigate('/')
      }
    }

    checkSession()

    // Listen for state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        navigate('/')
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        if (session?.user) {
          setSessionUser(session.user)
          await fetchUserRole(session.user)
        }
      }
    })

    return () => { subscription.unsubscribe() }
  }, [navigate])

  async function fetchUserRole(user) {
    try {
      // Use ilike for case-insensitive email matching
      const { data: profile, error } = await supabase
        .from('profesores')
        .select('rol')
        .ilike('email', user.email)
        .maybeSingle()
      
      if (error) throw error
      
      if (!profile) {
        console.warn('No profile found for email:', user.email)
        // If no profile, they might be a guest or incorrectly registered
        setRole('profesor') // Default to teacher if authenticated but no profile record
      } else {
        setRole(profile.rol)
      }
    } catch (error) {
      console.error('Error fetching role:', error.message)
      // Don't navigate away here yet, let TeacherDashboard handle missing data
      setRole('profesor')
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
      fontSize: '1rem',
      background: 'var(--bg)'
    }}>
      <div style={{ fontSize: '2rem' }}>⏳</div>
      <span>Cargando perfil...</span>
      <div style={{ fontSize: '0.8rem', opacity: 0.5 }}>Verificando acceso</div>
    </div>
  )

  return (
    <>
      {role === 'admin' ? (
        <AdminDashboard user={sessionUser} />
      ) : (
        <TeacherDashboard user={sessionUser} />
      )}
    </>
  )
}

export default Dashboard
