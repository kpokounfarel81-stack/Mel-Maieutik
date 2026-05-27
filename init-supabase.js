/**
 * NOTE
 * ---
 * Ce fichier a été nettoyé pour ne plus dépendre de SUPABASE_CONFIG hors-scope.
 * L’auth Supabase runtime est gérée par :
 *   - js/supabase.js (client browser)
 *   - env.js + window.__ENV__ (Netlify)
 */

// Intention historique (setup tables/RLS) :
// - utilitaire pour exécuter les SQL dans le dashboard Supabase.
// - ne doit pas s’exécuter côté navigateur.

// Si tu veux réactiver un comportement setup, déplace-le dans un script
// node/CLI ou un fichier dédié (sans fetch depuis le navigateur).


// Ne rien exécuter côté navigateur.
// Si ce fichier est chargé, il ne doit causer aucun effet ni dépendre de SUPABASE_CONFIG.

export {};


