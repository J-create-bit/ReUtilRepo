import { supabase } from './supabaseClient.js'

async function handleLogin(event) {
  event.preventDefault()
  const form = event.target
  const email = form.email.value
  const password = form.password.value

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    alert('Error al iniciar sesión: ' + error.message)
    return
  }

  await fetch('/api/set-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token: data.session.access_token })
  })

  window.location.href = '/views/inicio.html'  
}

window.handleLogin = handleLogin