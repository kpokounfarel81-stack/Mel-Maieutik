/**
 * Utilitaires UI et composants
 */

class UIManager {
    /**
     * Rendre du Markdown en HTML
     */
    static renderMarkdown(markdown) {
        try {
            let html = marked.parse(markdown);

            // Sécuriser le HTML rendu (XSS)
            html = DOMPurify.sanitize(html, {
                USE_PROFILES: { html: true }
            });

            // Utilisation d'un wrapper avec la classe 'prose' pour le style
            return `<div class="markdown-content prose max-w-none">${html}</div>`;
        } catch (error) {
            console.error('Erreur render markdown:', error);
            return `<p class="text-red-500">Erreur de rendu: ${error.message}</p>`;
        }
    }

    /**
     * Afficher une notification
     */
    static showNotification(message, type = 'info', duration = 3000) {
        const notification = document.createElement('div');
        notification.className = `fixed top-4 right-4 px-6 py-4 rounded-lg shadow-lg text-white z-50 animate-pulse`;
        
        switch(type) {
            case 'success':
                notification.classList.add('bg-green-500');
                break;
            case 'error':
                notification.classList.add('bg-red-500');
                break;
            case 'warning':
                notification.classList.add('bg-yellow-500');
                break;
            default:
                notification.classList.add('bg-blue-500');
        }
        
        notification.textContent = message;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, duration);
    }

    /**
     * Formater une date
     */
    static formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString('fr-FR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    /**
     * Tronquer un texte
     */
    static truncate(text, length = 100) {
        if (text.length > length) {
            return text.substring(0, length) + '...';
        }
        return text;
    }

    /**
     * Créer une carte d'exercice
     */
    static createExerciseCard(exercise) {
        const problemPreview = this.truncate(exercise.problem_statement, 100);
        const solutionPreview = this.truncate(exercise.solution_content, 150);
        const date = this.formatDate(exercise.created_at);

        return `
            <div class="p-6 bg-white rounded-lg shadow-sm hover:shadow-md transition border border-gray-200">
                <div class="mb-4">
                    <h3 class="font-semibold text-gray-900 mb-2">Problème</h3>
                    <p class="text-sm text-gray-600">${problemPreview}</p>
                </div>
                <div class="mb-4">
                    <h3 class="font-semibold text-gray-900 mb-2">Solution</h3>
                    <p class="text-sm text-gray-600">${solutionPreview}</p>
                </div>
                <div class="flex justify-between items-center text-xs text-gray-500">
                    <span>${date}</span>
                    <button onclick="router.openExercise('${exercise.id}')" class="text-blue-600 hover:underline font-semibold">
                        Voir
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * Afficher le loader
     */
    static showLoader(element, message = 'Chargement...') {
        element.innerHTML = `
            <div class="flex flex-col items-center justify-center py-12">
                <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
                <p class="text-gray-600">${message}</p>
            </div>
        `;
    }

    /**
     * Afficher une erreur
     */
    static showError(element, message) {
        element.innerHTML = `
            <div class="p-6 bg-red-50 border border-red-200 rounded-lg">
                <p class="text-red-700 font-semibold mb-2">Erreur</p>
                <p class="text-red-600 text-sm">${message}</p>
            </div>
        `;
    }

    /**
     * Parser le contenu avec LaTeX
     */
    static renderLaTeX() {
        if (window.MathJax) {
            MathJax.typesetPromise().catch(err => console.error('LaTeX error:', err));
        }
    }
}

// Alias pratique pour le code existant
const ui = UIManager;
