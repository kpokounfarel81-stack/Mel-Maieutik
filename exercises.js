/**
 * Gestionnaire des exercices
 */

class ExerciseManager {
    constructor() {
        this.exercises = [];
        this.currentExercise = null;
    }

    async loadUserExercises() {
        if (!authManager.isAuthenticated()) return [];

        const userId = authManager.getUserId();
        this.exercises = await supabase.getUserExercises(userId);
        return this.exercises;
    }

    async saveResolution(problemStatement, reasoning, solution) {
        if (!authManager.isAuthenticated()) {
            throw new Error('Authentification requise');
        }

        const userId = authManager.getUserId();
        const exercise = await supabase.saveExercise(
            userId,
            problemStatement,
            reasoning,
            solution
        );

        if (exercise) this.exercises.unshift(exercise);
        return exercise;
    }

    async solveProblem(problemStatement, options = {}) {
        const result = await deepseek.solveProblem(problemStatement, options);
        await this.saveResolution(problemStatement, result.reasoning, result.solution);
        return result;
    }

    async solveProblemStream(problemStatement, onReasoning, onSolution, options = {}) {
        const result = await deepseek.solveProblemStream(
            problemStatement,
            onReasoning,
            onSolution,
            options
        );

        try {
            await this.saveResolution(problemStatement, result.reasoning, result.solution);
        } catch (saveError) {
            console.warn('Sauvegarde impossible:', saveError);
        }

        return result;
    }

    async loadExercise(exerciseId) {
        this.currentExercise = await supabase.getExercise(exerciseId);
        return this.currentExercise;
    }

    setCurrentExercise(exercise) {
        this.currentExercise = exercise;
    }

    clearCurrentExercise() {
        this.currentExercise = null;
    }

    getExercises() {
        return this.exercises;
    }

    getExerciseCount() {
        return this.exercises.length;
    }
}

const exerciseManager = new ExerciseManager();
