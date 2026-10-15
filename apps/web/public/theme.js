// Applique le thème choisi avant le premier affichage : sans cela, un thème
// sombre clignoterait en clair au chargement. Fichier séparé plutôt que
// script en ligne, pour que la politique de sécurité interdise ces derniers.
try {
  var theme = localStorage.getItem("unichat.theme");
  if (theme === "clair" || theme === "sombre") document.documentElement.dataset.theme = theme;
} catch (e) {}
