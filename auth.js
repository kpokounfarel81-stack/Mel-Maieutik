/**
 * Gestionnaire d'authentification
 */

class AuthManager {
    constructor() {
        this.user = null;
        this.profile = null;
        this._initialized = false;
        // Ne pas initialiser ici - utiliser ensureInitialized()
    }

    /**
     * S'assurer que supabase est prêt avant d'accéder aux données
     */
    async ensureInitialized() {
        if (this._initialized) return;

        try {
            const sb = window.supabase;
            if (!sb) {
                throw new Error('Supabase n’est pas initialisé (window.supabase = null). Vérifie env.js / variables Netlify.');
            }
            
            if (sb && sb.ensureReady) {
                await sb.ensureReady();
            }
            
            this.initializeFromStorage();
        } catch (e) {
            console.warn('AuthManager init:', e?.message || e);
        }

        this._initialized = true;
    }

    initializeFromStorage() {
        try {
            const sb = window.supabase;
            if (sb && sb.getSession) {
                const session = sb.getSession();
                this.user = session?.user || null;
            }
        } catch {
            // ignore
        }
    }

    isAuthenticated() {
        const sb = window.supabase;
        return !!this.user && !!sb?.authToken;
    }

    async signup(email, password, fullName) {
        await this.ensureInitialized();
        try {
            const user = await window.supabase.signup(email, password, fullName);
            this.user = user;
            return { success: true, user };
        } catch (error) {
            console.error('Erreur inscription:', error);
            return { success: false, error: error.message };
        }
    }

    async login(email, password) {
        await this.ensureInitialized();
        try {
            const user = await window.supabase.login(email, password);
            this.user = user;
            this.profile = await window.supabase.getUserProfile(user.id);
            return { success: true, user };
        } catch (error) {
            console.error('Erreur connexion:', error);
            return { success: false, error: error.message };
        }
    }

    logout() {
        if (window.supabase) window.supabase.logout();
        this.user = null;
        this.profile = null;
        if (window.router) window.router.navigate('home');
    }
}

// Initialiser le gestionnaire d'authentification
const authManager = new AuthManager();

// Rendre l'instance accessible globalement (scripts non-modules / inline handlers)
// Nécessaire en déploiement (Netlify) pour que main.js puisse l'utiliser.
window.authManager = authManager;
