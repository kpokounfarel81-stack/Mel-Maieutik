/**
 * Routeur et orchestration de l'application
 */

class Router {
    constructor() {
        this.currentPage = null;
        this.routes = {
            home: 'homePage',
            login: 'loginPage',
            signup: 'signupPage',
            dashboard: 'dashboardPage',
            exercise: 'exercisePage',
            profile: 'profilePage'
        };
        this.init();
    }

    init() {
        window.addEventListener('hashchange', () => this.handleNavigation());
        this.handleNavigation();
    }

    navigate(page) {
        window.location.hash = page;
    }

    async openExercise(exerciseId) {
        const exercise = await exerciseManager.loadExercise(exerciseId);
        if (!exercise) {
            UIManager.showNotification('Exercice introuvable', 'error');
            return;
        }
        this.navigate('exercise');
    }

    newExercise() {
        exerciseManager.clearCurrentExercise();
        this.navigate('exercise');
    }

    async handleNavigation() {
        const page = window.location.hash.slice(1) || 'home';

        const authManager = window.authManager;
        if (!authManager) return;

        // S'assurer que la session est chargée depuis Supabase avant de décider de la route
        await authManager.ensureInitialized();

        if (['dashboard', 'exercise', 'profile'].includes(page) && !authManager.isAuthenticated()) {
            this.navigate('login');
            return;
        }

        if (['login', 'signup'].includes(page) && authManager.isAuthenticated()) {
            this.navigate('dashboard');
            return;
        }

        await this.loadPage(page);
    }

    async loadPage(page) {
        const templateId = this.routes[page] || 'homePage';
        const template = document.getElementById(templateId);
        if (!template) return;

        const app = document.getElementById('app');
        const loader = document.getElementById('loadingApp');
        if (loader) loader.style.display = 'none';

        app.innerHTML = '';
        app.appendChild(template.content.cloneNode(true));
        this.currentPage = page;

        switch (page) {
            case 'login':
                this.setupLoginPage();
                break;
            case 'signup':
                this.setupSignupPage();
                break;
            case 'dashboard':
                await this.setupDashboardPage();
                break;
            case 'exercise':
                this.setupExercisePage();
                break;
            case 'profile':
                await this.setupProfilePage();
                break;
        }
    }

    setupLoginPage() {
        const form = document.getElementById('loginForm');
        const errorDiv = document.getElementById('loginError');

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            errorDiv.classList.add('hidden');

            const auth = window.authManager;
            if (!auth) {
                errorDiv.textContent = 'AuthManager indisponible.';
                errorDiv.classList.remove('hidden');
                return;
            }

            const usernameEl = document.getElementById('loginUsername');
            const passEl = document.getElementById('loginPassword');

            if (!usernameEl || !passEl) {
                errorDiv.textContent = 'Champs de connexion manquants.';
                errorDiv.classList.remove('hidden');
                return;
            }

            const result = await auth?.login?.(
                usernameEl.value,
                passEl.value
            );

            if (result.success) {
                ui.showNotification('Connexion reussie!', 'success');
                this.navigate('dashboard');
            } else {
                errorDiv.textContent = result.error;
                errorDiv.classList.remove('hidden');
            }
        });
    }

    setupSignupPage() {
        const form = document.getElementById('signupForm');
        const errorDiv = document.getElementById('signupError');

        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const username = document.getElementById('signupUsername').value;
            const email = document.getElementById('signupEmail').value;
            const password = document.getElementById('signupPassword').value;

            if (password.length < 6) {
                errorDiv.textContent = 'Le mot de passe doit contenir au moins 6 caracteres';
                errorDiv.classList.remove('hidden');
                return;
            }

            errorDiv.classList.add('hidden');
            const result = await authManager.signup(email, password, username);

            if (result.success) {
                ui.showNotification('Inscription reussie!', 'success');
                this.navigate('dashboard');
            } else {
                errorDiv.textContent = result.error;
                errorDiv.classList.remove('hidden');
            }
        });
    }

    async setupDashboardPage() {
        await exerciseManager.loadUserExercises();
        const exercises = exerciseManager.getExercises();
        const exercisesList = document.getElementById('exercisesList');

        if (exercises.length === 0) {
            exercisesList.innerHTML = `
                <div class="p-8 bg-white rounded-xl border border-gray-200 text-center">
                    <p class="text-gray-600 mb-4">Vous n'avez pas encore d'exercices resolus</p>
                    <button onclick="router.newExercise()" class="px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:shadow-lg transition">
                        Resoudre votre premier exercice
                    </button>
                </div>
            `;
        } else {
            exercisesList.innerHTML = exercises
                .map(exercise => ui.createExerciseCard(exercise))
                .join('');
        }
    }

    setupExercisePage() {
        const form = document.getElementById('exerciseForm');
        const solveBtn = document.getElementById('solveBtn');
        const errorDiv = document.getElementById('exerciseError');
        const cacheNotice = document.getElementById('cacheNotice');
        const reasoningSection = document.getElementById('reasoningSection');
        const solutionSection = document.getElementById('solutionSection');
        const reasoningContent = document.getElementById('reasoningContent');
        const solutionContent = document.getElementById('solutionContent');
        const fileInput = document.getElementById('exerciseFiles');
        const fileList = document.getElementById('fileList');

        this.populateCurrentExercise();

        fileInput.addEventListener('change', () => {
            const files = Array.from(fileInput.files || []);
            fileList.textContent = files.length
                ? files.map(file => `${file.name} (${Math.ceil(file.size / 1024)} Ko)`).join(' | ')
                : '';
        });

        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const problemStatement = document.getElementById('exerciseInput').value.trim();
            const attempt = document.getElementById('attemptInput').value.trim();
            const mode = document.getElementById('aiMode').value;
            const files = Array.from(fileInput.files || []);

            if (!problemStatement && files.length === 0) {
                errorDiv.textContent = 'Ajoutez un enonce, une image ou un PDF.';
                errorDiv.classList.remove('hidden');
                return;
            }

            solveBtn.disabled = true;
            errorDiv.classList.add('hidden');
            cacheNotice.classList.add('hidden');
            reasoningSection.classList.remove('hidden');
            solutionSection.classList.remove('hidden');
            reasoningContent.innerHTML = this.loaderMarkup('Preparation de la demarche...');
            solutionContent.innerHTML = this.loaderMarkup('Generation de la reponse...');

            try {
                const attachments = await this.readAttachments(files);

                await exerciseManager.solveProblemStream(
                    problemStatement || this.describeAttachments(files),
                    (reasoning, fromCache) => {
                        if (fromCache) cacheNotice.classList.remove('hidden');
                        reasoningContent.innerHTML = UIManager.renderMarkdown(reasoning || 'Demarche indisponible');
                        UIManager.renderLaTeX();
                        reasoningContent.scrollTop = reasoningContent.scrollHeight;
                    },
                    (solution, fromCache) => {
                        if (fromCache) cacheNotice.classList.remove('hidden');
                        solutionContent.innerHTML = UIManager.renderMarkdown(solution || 'Solution indisponible');
                        UIManager.renderLaTeX();
                        solutionContent.scrollTop = solutionContent.scrollHeight;
                    },
                    { mode, attempt, attachments }
                );

                UIManager.showNotification('Reponse IA prete!', 'success');
                exerciseManager.clearCurrentExercise();
            } catch (error) {
                errorDiv.textContent = error.message;
                errorDiv.classList.remove('hidden');
                reasoningContent.innerHTML = '<p class="text-red-600">Erreur lors de la demarche</p>';
                solutionContent.innerHTML = '<p class="text-red-600">Erreur lors de la reponse IA</p>';
            } finally {
                solveBtn.disabled = false;
            }
        });
    }

    populateCurrentExercise() {
        const exercise = exerciseManager.currentExercise;
        if (!exercise) return;

        const input = document.getElementById('exerciseInput');
        const reasoningSection = document.getElementById('reasoningSection');
        const solutionSection = document.getElementById('solutionSection');
        const reasoningContent = document.getElementById('reasoningContent');
        const solutionContent = document.getElementById('solutionContent');

        input.value = exercise.problem_statement || '';
        reasoningSection.classList.remove('hidden');
        solutionSection.classList.remove('hidden');
        reasoningContent.innerHTML = UIManager.renderMarkdown(exercise.reasoning_content || 'Demarche indisponible');
        solutionContent.innerHTML = UIManager.renderMarkdown(exercise.solution_content || 'Solution indisponible');
        UIManager.renderLaTeX();
    }

    async readAttachments(files) {
        const validFiles = files.slice(0, 3).filter(file =>
            file.type.startsWith('image/') || file.type === 'application/pdf'
        );

        return Promise.all(validFiles.map(file => new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve({
                name: file.name,
                type: file.type,
                size: file.size,
                dataUrl: reader.result
            });
            reader.onerror = () => reject(new Error(`Lecture impossible: ${file.name}`));
            reader.readAsDataURL(file);
        })));
    }

    describeAttachments(files) {
        return `Piece jointe: ${files.map(file => file.name).join(', ')}`;
    }

    loaderMarkup(message) {
        return `
            <div class="flex flex-col justify-center items-center h-32 gap-3">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                <p class="text-sm text-gray-600">${message}</p>
            </div>
        `;
    }

    async setupProfilePage() {
        const profile = await authManager.loadProfile();
        const user = authManager.user;

        document.getElementById('profileName').value = profile?.full_name || user?.email || 'Non defini';
        document.getElementById('profileEmail').value = user?.email || '';
        document.getElementById('exerciseCount').textContent = exerciseManager.getExerciseCount();

        if (profile?.created_at) {
            document.getElementById('joinDate').textContent = ui.formatDate(profile.created_at);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.router = new Router();
    console.log('Application Maieutik initialisee');
});
