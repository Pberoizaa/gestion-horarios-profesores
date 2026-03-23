import { useState } from 'react'
import { supabase } from '../services/supabase'
import logo from '../assets/logo.jpg'

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleLogin = async (e) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    let finalEmail = email
    if (email && !email.includes('@')) {
      finalEmail = `${email}@icomercialpmt.cl`
    }

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: finalEmail,
        password,
      })
      if (error) {
        throw error
      }
      // Redirect to dashboard on successful login
      window.location.href = '/dashboard'
    } catch (error) {
      setError(error.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-container">
      <img src={logo} alt="Logo Instituto Comercial" className="login-logo" />
      <h1>Iniciar Sesión</h1>
      <form onSubmit={handleLogin}>
        <div className="form-group">
          <label htmlFor="email">Usuario o Email</label>
          <div className="input-with-hint">
            <input
              id="email"
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ej: fabian.aravena"
              required
            />
            {!email.includes('@') && email && (
              <span className="domain-hint">@icomercialpmt.cl</span>
            )}
          </div>
        </div>
        <div className="form-group">
          <label htmlFor="password">Contraseña</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <button type="submit" disabled={loading}>
          {loading ? 'Iniciando sesión...' : 'Iniciar Sesión'}
        </button>
        {error && <p className="error-message">{error}</p>}
      </form>
    </div>
  )
}

export default Login
