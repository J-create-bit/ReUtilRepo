import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://luvyjiasmpevwbfbyizt.supabase.co',
  'sb_publishable_BYnTBtPtVcu4IAZevptzAw_zYmbWiYk'
)

async function handleRegister(event) {
  event.preventDefault();
  const form = event.target;
  const email = form.email.value;
  const password = form.password.value;

  if (!email.endsWith('@maturana.edu.uy')) {
    alert('Solo se aceptan emails de Maturana');
    return;
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: 'https://google.com', 
      data: {
        nombre: form.nombre.value,
        telefono: form.telefono.value,
        direccion: form.zona.value,
      }
    }
  });

  if (error) {
    alert('Error: ' + error.message);
    return;
  }

  alert('Te enviamos un correo para confirmar tu cuenta.');
}

async function handleLogin(event) {
  event.preventDefault();
  const form = event.target;
  const email = form.email.value;
  const password = form.password.value;

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    alert('Error al iniciar sesión: ' + error.message);
    return;
  }
;
}