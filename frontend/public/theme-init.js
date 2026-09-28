// Aplica o tema antes de o React montar, para a página não "piscar" no tema errado.
// Mesma chave de src/lib/theme.tsx. Fica em arquivo (e não inline no index.html)
// para funcionar com a Content-Security-Policy do servidor (script-src 'self').
try {
  var t = localStorage.getItem("reservas-fmusp:tema");
  var dark = t === "dark" || ((t === null || t === "system") && matchMedia("(prefers-color-scheme: dark)").matches);
  if (dark) document.documentElement.classList.add("dark");
} catch (e) {}
