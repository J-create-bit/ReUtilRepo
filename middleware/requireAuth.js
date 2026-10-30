const { supabase } = require("../lib/supabaseClient");

async function requireAuth(req, res, next) {
  const token = req.cookies.access_token;

  if (!token) {
    res.cookie("post_login_redirect", req.originalUrl, { httpOnly: true, maxAge: 10 * 60 * 1000 });
    return res.redirect("/");
  }

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data?.user) {
    res.clearCookie("access_token");
    res.clearCookie("refresh_token");
    res.cookie("post_login_redirect", req.originalUrl, { httpOnly: true, maxAge: 10 * 60 * 1000 });
    return res.redirect("/");
  }

  req.user = data.user;
  next();
}

module.exports = requireAuth;