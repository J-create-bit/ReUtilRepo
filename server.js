const express = require("express");
const dotenv = require("dotenv");
const { createClient } = require("@supabase/supabase-js");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const path = require("path");
const fs = require("fs");

dotenv.config();
const app=express();
const PORT = process.env.PORT || 3000;


const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static("public"));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.post("/registro", async (req, res) => {

    const { nombre, email, password, telefono, direccion } = req.body;

    const { data, error } = await supabase.auth.signUp({
        email: email,
        password: password
    });

    if (error) {
        console.error("Error al registrar usuario:", error.message);

        return res.redirect(
            `/error.html?msg=${encodeURIComponent(error.message)}`
        );
    }

    const user = data.user;
    if (!user) {
        return res.redirect(
            `/error.html?msg=${encodeURIComponent("No se pudo crear el usuario")}`
        );
    }

    const { error: insertError } = await supabase
        .from("usuario")
        .insert([
            {
                id: user.id,
                nombre,
                email,
                telefono,
                direccion
            }
        ]);

    if (insertError) {
        console.error("Error al guardar los datos:", insertError.message);
        return res.redirect(
            `/error.html?msg=${encodeURIComponent(insertError.message)}`
        );
    }
    res.redirect("/confirmacion.html");
});

app.post("/is", async (req, res) => {
  const { email, password } = req.body;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) return res.redirect(`/error.html?msg=${encodeURIComponent(error.message)}`);

  res.cookie("access_token", data.session.access_token, { httpOnly: true });
  res.redirect("/private");
});

/*
app.get("/private", async (req, res) => {
  const token = req.cookies.access_token;
  if (!token) return res.redirect("/");

  const { data, error } = await supabase.auth.getUser(token);
  if (error) return res.redirect("/");

   const filePath = path.join(__dirname, "private.html");

   fs.readFile(filePath, "utf8", (err, html) => {
      if (err) {
        console.error("Error: private.html could not be loaded!", err);
        return res.status(500).send("Server error: private.html not found.");
      }
    
    const modifiedHtml = html.replace("{{userEmail}}", data.user.email);
    res.send(modifiedHtml);
  });
});

*/

app.get("/logout", (req, res) => {
  res.clearCookie("access_token");
  res.redirect("/");
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));