/**
 * Client IA Maieutik.
 * Les appels passent par server.js pour garder la cle API hors du navigateur.
 */

const AI_MODES = {
    solve: 'Resolution complete',
    hint: 'Indice progressif',
    guide: 'Questions guidees',
    review: 'Corriger ma tentative',
    explain: 'Expliquer autrement'
};

class DeepSeekAPI {
    constructor() {
        this.endpoint = '/api/ai/stream';
        this.cachePrefix = 'maieutik_ai_cache_';
    }

    async solveProblem(problemStatement, options = {}) {
        let reasoning = '';
        let solution = '';

        await this.solveProblemStream(
            problemStatement,
            (nextReasoning) => {
                reasoning = nextReasoning;
            },
            (nextSolution) => {
                solution = nextSolution;
            },
            options
        );

        return { reasoning, solution };
    }

    async solveProblemStream(problemStatement, onReasoning, onSolution, options = {}) {
        const requestPayload = {
            problemStatement: problemStatement || '',
            mode: options.mode || 'solve',
            attempt: options.attempt || '',
            attachments: options.attachments || []
        };

        const cacheKey = await this.getCacheKey(requestPayload);
        const cached = this.getCachedResult(cacheKey);
        if (cached) {
            if (onReasoning) onReasoning(cached.reasoning, true);
            if (onSolution) onSolution(cached.solution, true);
            return cached;
        }

        const response = await fetch(this.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestPayload)
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || 'Erreur API IA');
        }

        const result = await this.readEventStream(response, onReasoning, onSolution);
        this.setCachedResult(cacheKey, result);
        return result;
    }

    /**
     * SSE parsing robuste.
     * Le serveur envoie :
     *   event: reasoning\n data: {...}\n\n
     *   event: solution\n  data: {...}\n\n
     *   event: done\n       data: {...}\n\n
     */
    async readEventStream(response, onReasoning, onSolution) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        let buffer = '';
        let reasoning = '';
        let solution = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Les blocs SSE sont séparés par "\n\n".
            const blocks = buffer.split(/\n\n/);
            buffer = blocks.pop() || '';

            for (const block of blocks) {
                const parsed = this.parseSseEventBlock(block);
                if (!parsed) continue;

                if (parsed.event === 'reasoning') {
                    const delta = parsed.data?.delta ?? '';
                    if (delta) reasoning += delta;
                    if (onReasoning) onReasoning(reasoning, false);
                }

                if (parsed.event === 'solution') {
                    const delta = parsed.data?.delta ?? '';
                    if (delta) solution += delta;
                    if (onSolution) onSolution(solution, false);
                }

                if (parsed.event === 'done') {
                    if (typeof parsed.data?.reasoning === 'string' && parsed.data.reasoning.trim()) {
                        reasoning = parsed.data.reasoning;
                    }
                    if (typeof parsed.data?.solution === 'string' && parsed.data.solution.trim()) {
                        solution = parsed.data.solution;
                    }
                    if (onReasoning) onReasoning(reasoning, false);
                    if (onSolution) onSolution(solution, false);
                }

                if (parsed.event === 'error') {
                    throw new Error(parsed.data?.error || 'Erreur streaming IA');
                }
            }
        }

        return {
            reasoning: reasoning || 'Demarche integree dans la reponse.',
            solution: solution || 'Solution indisponible'
        };
    }

    // Accepte plusieurs lignes "data:" (RFC SSE) et reconstitue le JSON.
    parseSseEventBlock(block) {
        if (!block || !block.trim()) return null;

        const lines = block.split(/\r?\n/);
        let event = null;
        const dataLines = [];

        for (const line of lines) {
            if (line.startsWith('event:')) {
                event = line.slice('event:'.length).trim();
                continue;
            }
            if (line.startsWith('data:')) {
                dataLines.push(line.slice('data:'.length).trim());
            }
        }

        if (!event || dataLines.length === 0) return null;

        try {
            const dataRaw = dataLines.join('\n');
            return { event, data: JSON.parse(dataRaw) };
        } catch (e) {
            console.warn('Evenement IA ignore:', e);
            return null;
        }
    }

    async getCacheKey(payload) {
        const compactPayload = {
            problemStatement: payload.problemStatement,
            mode: payload.mode,
            attempt: payload.attempt,
            attachments: (payload.attachments || []).map(file => ({
                name: file.name,
                type: file.type,
                size: file.size
            }))
        };

        const encoded = new TextEncoder().encode(JSON.stringify(compactPayload));
        const hash = await crypto.subtle.digest('SHA-256', encoded);
        const hex = Array.from(new Uint8Array(hash))
            .map(byte => byte.toString(16).padStart(2, '0'))
            .join('');
        return `${this.cachePrefix}${hex}`;
    }

    getCachedResult(cacheKey) {
        try {
            const raw = localStorage.getItem(cacheKey);
            if (!raw) return null;
            const cached = JSON.parse(raw);
            const maxAge = 1000 * 60 * 60 * 24;
            if (Date.now() - cached.createdAt > maxAge) {
                localStorage.removeItem(cacheKey);
                return null;
            }
            return cached.result;
        } catch {
            return null;
        }
    }

    setCachedResult(cacheKey, result) {
        try {
            localStorage.setItem(cacheKey, JSON.stringify({
                createdAt: Date.now(),
                result
            }));
        } catch {
            // Le cache est un bonus; l'app continue sans lui.
        }
    }
}

const deepseek = new DeepSeekAPI();

