export default {

    async fetch(request, env, ctx) {

        const url = new URL(request.url);


        // ============================================================
        // INDEX PRINCIPAL
        // ============================================================

        if (
            url.pathname === "/" ||
            url.pathname === "/index.html"
        ) {

            const assetUrl = new URL("/index.html", request.url);

            const assetRequest = new Request(
                assetUrl.toString(),
                request
            );

            const respuesta = await env.ASSETS.fetch(assetRequest);


            // ========================================================
            // EVITAR CACHE DEL INDEX.HTML
            // ========================================================

            const headers = new Headers(respuesta.headers);

            headers.set(
                "Cache-Control",
                "no-store, no-cache, must-revalidate, max-age=0"
            );

            headers.set(
                "Pragma",
                "no-cache"
            );

            headers.set(
                "Expires",
                "0"
            );


            return new Response(
                respuesta.body,
                {
                    status: respuesta.status,
                    statusText: respuesta.statusText,
                    headers: headers
                }
            );
        }


        // ============================================================
        // RESTO DE ARCHIVOS ESTÁTICOS
        // ============================================================

        return env.ASSETS.fetch(request);

    }

};
