/**
 * Supabase client (auth réelle) pour Maieutik.
 * - Ne modifie pas les clés existantes (url/anonKey restent dans SUPABASE_CONFIG)
 * - Remplace le mode mock dev par une auth Supabase via @supabase/supabase-js
 */

// Récupère createClient depuis l'objet global exposé par le CDN
const { createClient } = window.supabase;

// Configuration Supabase - injectée via env.js (généré par Netlify)
// IMPORTANT: si SUPABASE_URL / SUPABASE_ANON_KEY sont vides, on log une erreur claire.
const SUPABASE_URL_FROM_ENV = window?.__ENV__?.SUPABASE_URL;
const SUPABASE_ANON_KEY_FROM_ENV = window?.__ENV__?.SUPABASE_ANON_KEY;

const SUPABASE_CONFIG = {
    url: (SUPABASE_URL_FROM_ENV && SUPABASE_URL_FROM_ENV.indexOf('http') === 0)
        ? SUPABASE_URL_FROM_ENV.trim()
        : "",
    anonKey: (SUPABASE_ANON_KEY_FROM_ENV && SUPABASE_ANON_KEY_FROM_ENV.length > 20)
        ? SUPABASE_ANON_KEY_FROM_ENV.trim()
        : ""
};

function assertSupabaseConfig() {
    if (!SUPABASE_CONFIG.url || !SUPABASE_CONFIG.anonKey) {
        console.error('[Supabase] Clés manquantes : SUPABASE_URL ou SUPABASE_ANON_KEY sont vides.' +
            ' Vérifie env.js (généré par Netlify) ou tes variables Netlify / env.local.' +
            ' Exemple attendu : window.__ENV__.SUPABASE_URL et window.__ENV__.SUPABASE_ANON_KEY');
        return false;
    }
    return true;
}



class SupabaseClient {
    constructor(config) {
        this._signupInFlight = false;

        this.url = config.url;
        this.anonKey = config.anonKey;

        // storage: on réutilise localStorage pour garder compat avec le reste du code
        this.supabase = createClient(this.url, this.anonKey, {
            auth: {
                persistSession: true,
                storageKey: 'supabase_auth'
            }
        });

        this.session = null;
        this.user = null;

        // Hydrate init (asynchrone)
        this._initPromise = this._hydrate();

        // Exposer une compat côté code existant
        this.authToken = localStorage.getItem('supabase_token');
    }

    async _hydrate() {
        try {
            const { data } = await this.supabase.auth.getSession();
            this.session = data.session;
            this.user = data.session?.user || null;

            // compat avec l’ancien code qui stocke supabase_token/supabase_user
            const token = this.session?.access_token || null;
            if (token) {
                localStorage.setItem('supabase_token', token);
                localStorage.setItem('supabase_user', JSON.stringify(this.user));
                this.authToken = token;
            }
        } catch (e) {
            console.warn('Supabase hydrate session:', e?.message || e);
        }

        // keep it updated
        this.supabase.auth.onAuthStateChange((_event, session) => {
            this.session = session;
            this.user = session?.user || null;

            const token = this.session?.access_token || null;
            if (token) {
                localStorage.setItem('supabase_token', token);
                localStorage.setItem('supabase_user', JSON.stringify(this.user));
                this.authToken = token;
            } else {
                localStorage.removeItem('supabase_token');
                localStorage.removeItem('supabase_user');
                this.authToken = null;
            }
        });
    }

    async ensureReady() {
        return this._initPromise;
    }

    // Compat pour le reste du code (authManager.isAuthenticated)
    getSession() {
        return this.session;
    }

    isReady() {
        return !!this.session;
    }

    get auth() {
        return this.supabase.auth;
    }

    normalizeSignupEmail(email) {
        if (typeof email !== 'string') return email;
        const trimmed = email.trim();

        // mode dev/test: uniquement sur localhost / 127.0.0.1 (on force un domaine fictif)
        const isLocalhost = (() => {
            try {
                return typeof window !== 'undefined' && /^(localhost|127\\.0\\.0\\.1)$/.test(window.location.hostname);
            } catch {
                return false;
            }
        })();

        const atIndex = trimmed.lastIndexOf('@');
        if (atIndex <= 0 || atIndex === trimmed.length - 1) return trimmed;

        const domain = trimmed.slice(atIndex + 1).toLowerCase();

        if (isLocalhost && domain !== 'example.com') {
            return `${trimmed.slice(0, atIndex)}@example.com`;
        }

        return trimmed;
    }

    async signup(email, password, fullName) {
        await this.ensureReady();

        // Anti-double-submit: évite les appels parallèles qui déclenchent parfois des limites (429).
        if (this._signupInFlight) {
            throw new Error('Inscription déjà en cours. Veuillez patienter.');
        }
        this._signupInFlight = true;

        try {
            const normalizedEmail = this.normalizeSignupEmail(email);

            const { data, error } = await this.supabase.auth.signUp({
                email: normalizedEmail,
                password,
                options: {
                    data: { full_name: fullName }
                }
            });

            if (error) throw error;

            // Certains configs demandent confirmation email: on retourne success même si session null
            // On essaye quand même de récupérer la session/user si disponible.
            const { data: sessData } = await this.supabase.auth.getSession();
            this.session = sessData.session;
            this.user = sessData.session?.user || data.user || null;

            if (!this.user) {
                // L’utilisateur peut exister sans être connecté
                return data.user;
            }

            // Crée profil (RLS attend user_id = auth.uid())
            await this.createUserProfile(this.user.id, normalizedEmail, fullName).catch(() => {});

            // expose compat
            const token = this.session?.access_token || null;
            if (token) {
                localStorage.setItem('supabase_token', token);
                localStorage.setItem('supabase_user', JSON.stringify(this.user));
                this.authToken = token;
            }

            return this.user;
        } finally {
            this._signupInFlight = false;
        }
    }

    async login(email, password) {
        await this.ensureReady();

        const { data, error } = await this.supabase.auth.signInWithPassword({
            email,
            password
        });

        if (error) throw error;

        this.session = data.session;
        this.user = data.user || data.session?.user || null;

        const token = this.session?.access_token || null;
        if (token) {
            localStorage.setItem('supabase_token', token);
            localStorage.setItem('supabase_user', JSON.stringify(this.user));
            this.authToken = token;
        }

        return this.user;
    }

    logout() {
        try {
            this.supabase.auth.signOut();
        } catch {
            // ignore
        }

        this.session = null;
        this.user = null;
        localStorage.removeItem('supabase_token');
        localStorage.removeItem('supabase_user');
        this.authToken = null;

        // router est global dans main.js
        router.navigate('home');
    }

    // Récupérer l’access token actuel
    get accessToken() {
        return this.session?.access_token || this.authToken || null;
    }

    async createUserProfile(userId, email, fullName) {
        const { error } = await this.supabase.from('profiles').insert({
            user_id: userId,
            email,
            full_name: fullName
        });

        // non-bloquant (profil peut déjà exister)
        if (error) {
            // eslint-disable-next-line no-console
            console.warn('Create profile (maybe exists):', error.message || error);
        }
    }

    async getUserProfile(userId) {
        await this.ensureReady();

        const { data, error } = await this.supabase
            .from('profiles')
            .select('*')
            .eq('user_id', userId)
            .maybeSingle();

        if (error) {
            console.error('Erreur récupération profil:', error.message || error);
            return null;
        }
        return data || null;
    }

    async saveExercise(userId, problemStatement, reasoning, solution) {
        await this.ensureReady();

        const { data, error } = await this.supabase.from('exercises').insert({
            user_id: userId,
            problem_statement: problemStatement,
            reasoning_content: reasoning,
            solution_content: solution
        }).select('*').maybeSingle();

        if (error) {
            console.error('Erreur sauvegarde exercice:', error.message || error);
            throw error;
        }

        // compat avec l’ancien code: retourner un objet
        return data || null;
    }

    async getUserExercises(userId, limit = 10) {
        await this.ensureReady();

        const { data, error } = await this.supabase
            .from('exercises')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) {
            console.error('Erreur récupération exercices:', error.message || error);
            return [];
        }

        return data || [];
    }

    async getExercise(exerciseId) {
        await this.ensureReady();

        const { data, error } = await this.supabase
            .from('exercises')
            .select('*')
            .eq('id', exerciseId)
            .maybeSingle();

        if (error) {
            console.error('Erreur récupération exercice:', error.message || error);
            return null;
        }

        return data || null;
    }
}

// Initialiser le client Supabase (global attendu par le reste du code)
// Expose global pour le reste du code (scripts non-modules)
// Exposer au global pour les scripts non-modules (auth.js, ui.js, main.js)
if (assertSupabaseConfig()) {
    window.supabase = new SupabaseClient(SUPABASE_CONFIG);
    // IMPORTANT: on ne déclare PAS un `const supabase = ...` ici, sinon la variable n'est pas globale.
    window.supabaseClient = window.supabase;
} else {
    // Crée une instance vide pour éviter des crashs référencements en attendant env.js.
    window.supabase = null;
    window.supabaseClient = null;
}
