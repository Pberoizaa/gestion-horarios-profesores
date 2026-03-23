import { useState, useEffect } from 'react'
import { supabase } from '../services/supabase'
import AdminDashboard from './AdminDashboard'
import TeacherDashboard from './TeacherDashboard'

function Dashboard() {
  const [role, setRole] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        window.location.href = '/'
      }
    })

    fetchUserRole()

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  async function fetchUserRole() {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        window.location.href = '/'
        return
      }

      const { data: profile, error } = await supabase
        .from('profesores')
        .select('rol')
        .eq('email', user.email)
        .single()
      
      if (error) throw error
      setRole(profile.rol)
    } catch (error) {
      console.error('Error fetching role:', error.message)
      // Redirect to login if user profile not found or other error
      window.location.href = '/'
    } finally {
      setLoading(false)
    }
  }

  if (loading) return <div>Cargando dashboard...</div>

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
