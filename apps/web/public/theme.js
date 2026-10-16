// Applique le thème choisi avant le premier affichage : sans cela, un thème
// sombre clignoterait en clair au chargement. Fichier séparé plutôt que
// script en ligne, pour que la politique de sécurité interdise ces derniers.
try {
  var theme = localStorage.getItem("unichat.theme");
  if (theme === "clair" || theme === "sombre") document.documentElement.dataset.theme = theme;
} catch (e) {}
// Fond des discussions (teinte et motif), pour la même raison.
try {
  var fond = localStorage.getItem("unichat.fond");
  if (fond === "brume" || fond === "sable" || fond === "sauge" || fond === "lavande") document.documentElement.dataset.fond = fond;
  if (localStorage.getItem("unichat.motif") === "non") document.documentElement.dataset.motif = "non";
} catch (e) {}
