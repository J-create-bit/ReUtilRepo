const express = require("express");
const dotenv = require("dotenv");
const cookieParser = require("cookie-parser");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const QRCode = require("qrcode");

dotenv.config(); 

const { supabase, supabaseAdmin } = require("./lib/supabaseClient");
const requireAuth = require("./middleware/requireAuth");

const app = express();
const PORT = process.env.PORT || 3000;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

function redirectError(res, message) {
  return res.redirect(`/error.html?msg=${encodeURIComponent(message)}`);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function generarTitulo({ categoria, tipo, talle, colegio, materia, estado }) {
  if (categoria === "Materiales") {
    return `${tipo} de ${materia} - ${estado}`;
  }
  return `${tipo} talle ${talle} de ${colegio} - ${estado}`;
}

async function armarDatosFeed(objetos) {
  if (!objetos.length) return [];
  const ids = [...new Set(objetos.map((o) => o.user_id).filter(Boolean))];
  if (!ids.length) return objetos.map((o) => ({ ...o, dueno: null }));
  const { data: duenos } = await supabase.from("usuario").select("id, nombre, email, telefono").in("id", ids);
  const mapaDuenos = Object.fromEntries((duenos || []).map((d) => [d.id, d]));
  return objetos.map((o) => ({ ...o, dueno: mapaDuenos[o.user_id] || null }));
}

function renderListado(objetos, opciones = {}) {
  const { propioUserId } = opciones;

  if (!objetos.length) {
    return `<div class="vacio">Todavía no hay publicaciones. <a href="/publicar">Sé el primero en publicar algo</a>.</div>`;
  }

  const items = objetos
    .map((o) => {
      const esPropia = propioUserId && o.user_id === propioUserId;
      const pausada = o.activo === false;
      let extra = "";
      if (esPropia) {
        extra = `
          <div class="info-extra">
            ${pausada ? '<span class="badge-pausada">Pausada</span>' : ""}
            <div class="acciones-propias">
              <button type="button" class="btn-pausar" data-id="${o.id}" data-activo="${o.activo}">${pausada ? "Reanudar" : "Pausar"}</button>
              <button type="button" class="btn-entregar" data-id="${o.id}" data-titulo="${escapeHtml(o.titulo)}">Entregar</button>
            </div>
          </div>`;
      }
      return `
      <article class="item${pausada ? " pausada" : ""}" data-id="${o.id}">
        <div class="foto" style="background-image:url('${escapeHtml(o.foto_url || "")}')"></div>
        <h3>${escapeHtml(o.titulo)}</h3>
        ${extra}
      </article>`;
    })
    .join("");

  return `<main class="listado">${items}</main>`;
}

function tiempoDesde(fechaIso) {
  if (!fechaIso) return "Sin actividad";
  const diffMs = Date.now() - new Date(fechaIso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 60) return `${min || 1} min`;
  const horas = Math.floor(min / 60);
  if (horas < 24) return `${horas} horas`;
  const dias = Math.floor(horas / 24);
  return `${dias} días`;
}

function paginaMensaje({ titulo, mensaje, ok }) {
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(titulo)} - ReÚtil</title><link rel="stylesheet" href="/style.css">
<style>
  .mensaje-pagina { max-width:480px; margin:80px auto; padding:40px; border:2px solid var(--gris-linea); border-radius:8px; text-align:center; }
  .mensaje-pagina h1 { font-size:24px; margin-bottom:16px; }
  .mensaje-pagina a { display:inline-block; margin-top:24px; font-weight:700; border:2px solid var(--gris-linea); padding:10px 20px; border-radius:6px; text-decoration:none; color:var(--texto); }
</style></head>
<body>
  <div class="mensaje-pagina">
    <h1>${ok ? "Éxito " : "Alerta "}${escapeHtml(titulo)}</h1>
    <p>${escapeHtml(mensaje)}</p>
    <a href="/private">Volver al inicio</a>
  </div>
</body></html>`;
}

app.get("/", async (req, res) => {
  const token = req.cookies.access_token;
  if (token) {
    const { data } = await supabase.auth.getUser(token);
    if (data?.user) {
      return res.redirect("/private");
    }
  }
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.post("/registro", async (req, res) => {
  const { nombre, email, password, telefono, direccion } = req.body;

  if (!nombre || !email || !password || !telefono || !direccion) {
    return redirectError(res, "Faltan campos obligatorios.");
  }

  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    console.error("Error al registrar usuario:", error.message);
    return redirectError(res, error.message);
  }

  const user = data.user;
  if (!user) {
    return redirectError(res, "No se pudo crear el usuario.");
  }

  const { error: insertError } = await supabaseAdmin.from("usuario").insert([
    { id: user.id, nombre, email, telefono, direccion },
  ]);

  if (insertError) {
    console.error("Error al guardar los datos:", insertError.message);
    await supabaseAdmin.auth.admin.deleteUser(user.id);
    return redirectError(res, insertError.message);
  }

  if (!data.session) {
    return res.redirect("/confirmacion.html");
  }

  res.cookie("access_token", data.session.access_token, { httpOnly: true });
  res.cookie("refresh_token", data.session.refresh_token, { httpOnly: true });
  const destino = req.cookies.post_login_redirect;
  res.clearCookie("post_login_redirect");
  res.redirect(destino || "/private");
});

app.post("/is", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return redirectError(res, "Ingresá email y contraseña.");
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    console.error("Error al iniciar sesión:", error.message);
    return redirectError(res, error.message);
  }

  res.cookie("access_token", data.session.access_token, { httpOnly: true });
  res.cookie("refresh_token", data.session.refresh_token, { httpOnly: true });
  const destino = req.cookies.post_login_redirect;
  res.clearCookie("post_login_redirect");
  res.redirect(destino || "/private");
});

app.get("/private", requireAuth, async (req, res) => {
  const filePath = path.join(__dirname, "private.html");
  const q = (req.query.q || "").trim();
  const categoria = req.query.categoria || "";

  const { data: perfil } = await supabase.from("usuario").select("nombre").eq("id", req.user.id).single();
  const nombre = perfil?.nombre || req.user.email;
  const inicial = nombre.charAt(0).toUpperCase();

  let consulta = supabase
    .from("objetos")
    .select("id, titulo, foto_url, tipo, talle, colegio, materia, categoria, estado, descripcion, activo, user_id, created_at")
    .eq("activo", true)
    .neq("user_id", req.user.id)
    .order("created_at", { ascending: false })
    .limit(30);

  if (q) consulta = consulta.ilike("titulo", `%${q}%`);
  if (categoria) consulta = consulta.eq("categoria", categoria);

  const { data: objetos, error: objError } = await consulta;

  if (objError) console.error("Error al traer objetos:", objError.message);

  const datosFeed = await armarDatosFeed(objetos || []);
  const listadoHtml = renderListado(datosFeed);

  fs.readFile(filePath, "utf8", (err, html) => {
    if (err) {
      console.error("Error: private.html no se pudo leer.", err);
      return res.status(500).send("Error del servidor: private.html no encontrado.");
    }
    const modifiedHtml = html
      .replace("{{userNombre}}", nombre)
      .replace("{{userInicial}}", inicial)
      .replace("{{listado}}", listadoHtml)
      .replace("{{qValue}}", escapeHtml(q))
      .replace("{{datosPublicaciones}}", JSON.stringify(datosFeed));
    res.send(modifiedHtml);
  });
});

app.get("/publicar", requireAuth, async (req, res) => {
  const filePath = path.join(__dirname, "nuevo.html");

  const { data: perfil } = await supabase.from("usuario").select("nombre").eq("id", req.user.id).single();
  const nombre = perfil?.nombre || req.user.email;

  fs.readFile(filePath, "utf8", (err, html) => {
    if (err) {
      console.error("Error: nuevo.html no se pudo leer.", err);
      return res.status(500).send("Error del servidor: nuevo.html no encontrado.");
    }
    const modifiedHtml = html
      .replace(/{{userNombre}}/g, nombre)
      .replace(/{{userInicial}}/g, nombre.charAt(0).toUpperCase());
    res.send(modifiedHtml);
  });
});

app.post("/publicar", requireAuth, upload.single("foto"), async (req, res) => {
  const { categoria, descripcion, talle, colegio, estado, materia } = req.body;
  const tipo = categoria === "Materiales" ? req.body.tipo_material : req.body.tipo_ropa;
  const foto = req.file;

  if (!categoria || !tipo || !estado || !descripcion) {
    return redirectError(res, "Faltan campos obligatorios.");
  }
  if (categoria === "Ropa/Uniformes" && (!talle || !colegio)) {
    return redirectError(res, "Faltan campos obligatorios (talle y colegio).");
  }
  if (categoria === "Materiales" && !materia) {
    return redirectError(res, "Faltan campos obligatorios (materia).");
  }
  if (!foto) {
    return redirectError(res, "Tenés que subir una foto.");
  }

  const extension = path.extname(foto.originalname) || ".jpg";
  const nombreArchivo = `${req.user.id}/${Date.now()}${extension}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from("objetos")
    .upload(nombreArchivo, foto.buffer, { contentType: foto.mimetype });

  if (uploadError) {
    console.error("Error al subir la foto:", uploadError.message);
    return redirectError(res, "No se pudo subir la foto: " + uploadError.message);
  }

  const { data: publicUrlData } = supabaseAdmin.storage.from("objetos").getPublicUrl(nombreArchivo);

  const titulo = generarTitulo({
    categoria,
    tipo,
    talle: categoria === "Ropa/Uniformes" ? talle : null,
    colegio: categoria === "Ropa/Uniformes" ? colegio : null,
    materia: categoria === "Materiales" ? materia : null,
    estado,
  });

  const { error: insertError } = await supabaseAdmin.from("objetos").insert([
    {
      user_id: req.user.id,
      categoria,
      tipo,
      talle: categoria === "Ropa/Uniformes" ? talle : null,
      colegio: categoria === "Ropa/Uniformes" ? colegio : null,
      materia: categoria === "Materiales" ? materia : null,
      estado,
      descripcion,
      titulo,
      foto_url: publicUrlData.publicUrl,
      activo: true,
    },
  ]);

  if (insertError) {
    console.error("Error al guardar el objeto:", insertError.message);
    return redirectError(res, insertError.message);
  }

  await supabaseAdmin.from("usuario").update({ ultimo_cambio: new Date().toISOString() }).eq("id", req.user.id);

  res.redirect("/private");
});

app.get("/perfil", requireAuth, (req, res) => {
  res.redirect(`/perfil/${req.user.id}`);
});

app.get("/perfil/:id", requireAuth, async (req, res) => {
  const idPerfil = req.params.id;
  const q = (req.query.q || "").trim();

  const { data: propietario } = await supabase
    .from("usuario")
    .select("id, nombre, email, telefono, direccion, created_at, objetos_dados, objetos_recibidos, ultimo_cambio")
    .eq("id", idPerfil)
    .single();

  if (!propietario) {
    return redirectError(res, "Ese perfil no existe.");
  }

  const { data: miPerfil } = await supabase.from("usuario").select("nombre").eq("id", req.user.id).single();
  const miNombre = miPerfil?.nombre || req.user.email;

  let consultaObjetos = supabase
    .from("objetos")
    .select("id, titulo, foto_url, tipo, talle, colegio, materia, categoria, estado, descripcion, activo, user_id, created_at")
    .eq("user_id", idPerfil)
    .order("created_at", { ascending: false });

  if (q) consultaObjetos = consultaObjetos.ilike("titulo", `%${q}%`);

  const { data: objetos, error: objError } = await consultaObjetos;

  if (objError) console.error("Error al traer el catálogo:", objError.message);

  const esPropio = idPerfil === req.user.id;
  const datosFeed = (objetos || []).map((o) => ({
    ...o,
    dueno: { id: propietario.id, nombre: propietario.nombre, email: propietario.email, telefono: propietario.telefono },
  }));
  const catalogoHtml = renderListado(datosFeed, { propioUserId: esPropio ? req.user.id : null });

  const filePath = path.join(__dirname, "perfil.html");
  fs.readFile(filePath, "utf8", (err, html) => {
    if (err) {
      console.error("Error: perfil.html no se pudo leer.", err);
      return res.status(500).send("Error del servidor: perfil.html no encontrado.");
    }
    const fechaCreacion = propietario.created_at
      ? new Date(propietario.created_at).toLocaleDateString("es-UY")
      : "-";

    const modifiedHtml = html
      .replace(/{{userNombre}}/g, miNombre)
      .replace(/{{userInicial}}/g, miNombre.charAt(0).toUpperCase())
      .replace(/{{perfilNombre}}/g, escapeHtml(propietario.nombre))
      .replace(/{{perfilPrimerNombre}}/g, escapeHtml(propietario.nombre.split(" ")[0]))
      .replace(/{{perfilInicial}}/g, propietario.nombre.charAt(0).toUpperCase())
      .replace(/{{perfilDados}}/g, propietario.objetos_dados ?? 0)
      .replace(/{{perfilRecibidos}}/g, propietario.objetos_recibidos ?? 0)
      .replace(/{{perfilFechaCreacion}}/g, fechaCreacion)
      .replace(/{{perfilUltimaActividad}}/g, tiempoDesde(propietario.ultimo_cambio))
      .replace(/{{perfilUbicacion}}/g, escapeHtml(propietario.direccion || "Sin ubicación cargada"))
      .replace(/{{perfilQuerySuffix}}/g, `/${idPerfil}`)
      .replace(/{{qValue}}/g, escapeHtml(q))
      .replace("{{catalogoListado}}", catalogoHtml)
      .replace("{{datosPublicaciones}}", JSON.stringify(datosFeed));

    res.send(modifiedHtml);
  });
});

app.post("/publicaciones/:id/pausar", requireAuth, async (req, res) => {
  const { id } = req.params;

  const { data: objeto } = await supabaseAdmin.from("objetos").select("user_id, activo").eq("id", id).single();
  if (!objeto) return res.status(404).json({ error: "Publicación no encontrada." });
  if (objeto.user_id !== req.user.id) return res.status(403).json({ error: "No es tu publicación." });

  const nuevoActivo = !objeto.activo;
  const { error } = await supabaseAdmin.from("objetos").update({ activo: nuevoActivo }).eq("id", id);
  if (error) return res.status(500).json({ error: "No se pudo actualizar." });

  res.json({ ok: true, activo: nuevoActivo });
});

app.post("/publicaciones/:id/iniciar-entrega", requireAuth, async (req, res) => {
  const { id } = req.params;

  const { data: objeto } = await supabaseAdmin.from("objetos").select("user_id").eq("id", id).single();
  if (!objeto) return res.status(404).json({ error: "Publicación no encontrada." });
  if (objeto.user_id !== req.user.id) return res.status(403).json({ error: "No es tu publicación." });

  const token = crypto.randomUUID();
  const { error } = await supabaseAdmin.from("objetos").update({ token_entrega: token }).eq("id", id);
  if (error) return res.status(500).json({ error: "No se pudo generar el código." });

  const url = `${req.protocol}://${req.get("host")}/recibir/${token}`;
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 280 });

  res.json({ url, qr });
});

app.get("/recibir/:token", requireAuth, async (req, res) => {
  const { token } = req.params;

  const { data: objeto } = await supabaseAdmin.from("objetos").select("*").eq("token_entrega", token).single();

  if (!objeto) {
    return res.send(paginaMensaje({ titulo: "Código no válido", mensaje: "Código ya usado o no existente", ok: false }));
  }
  if (objeto.user_id === req.user.id) {
    return res.send(paginaMensaje({
      titulo: "ERROR: Publicación propia",
      mensaje: "No podés confirmar la recepción de algo que vos mismo publicaste.",
      ok: false,
    }));
  }

  const ahora = new Date().toISOString();

  const { data: dueno } = await supabaseAdmin.from("usuario").select("objetos_dados").eq("id", objeto.user_id).single();
  await supabaseAdmin
    .from("usuario")
    .update({ objetos_dados: (dueno?.objetos_dados || 0) + 1, ultimo_cambio: ahora })
    .eq("id", objeto.user_id);

  const { data: receptor } = await supabaseAdmin.from("usuario").select("objetos_recibidos").eq("id", req.user.id).single();
  await supabaseAdmin
    .from("usuario")
    .update({ objetos_recibidos: (receptor?.objetos_recibidos || 0) + 1, ultimo_cambio: ahora })
    .eq("id", req.user.id);

  await supabaseAdmin.from("objetos").delete().eq("id", objeto.id);

  res.send(paginaMensaje({
    titulo: "¡Listo!",
    mensaje: `Confirmaste que recibiste "${objeto.titulo}". Se sumó a tus objetos recibidos.`,
    ok: true,
  }));
});

app.get("/logout", (req, res) => {
  res.clearCookie("access_token");
  res.clearCookie("refresh_token");
  res.redirect("/");
});

app.listen(PORT, () => console.log(`Servidos corriendo en: http://localhost:${PORT}`));