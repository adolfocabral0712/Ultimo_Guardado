export default {
    async fetch(request, env) {
        return env.ASSETS.fetch(request);
    },

    async scheduled(controller, env, ctx) {
        console.log("Revisión programada pendiente de conectar al JSON");
    }
};
