// ============================================================
// CONTROL DE ACTUALIZACIÓN DE JSON
// Cloudflare Worker
// ============================================================

const FUENTES = [
    {
        nombre: "AGREGAR CONDUCTORES A REMITO SP",
        variable: "AGREGAR_CONDUCTORES_URL"
    },
    {
        nombre: "CONSULTAS SISTEMA",
        variable: "CONSULTAS_SISTEMA_URL"
    },
    {
        nombre: "DATOS ARCGIS",
        variable: "DATOS_ARCGIS_URL"
    },
    {
        nombre: "MEDICIONES",
        variable: "MEDICIONES_URL"
    },
    {
        nombre: "PLANILLA",
        variable: "PLANILLA_URL"
    },
    {
        nombre: "PLANILLA JAUSER",
        variable: "PLANILLA_JAUSER_URL"
    },
    {
        nombre: "TABLERO PREDIO",
        variable: "TABLERO_PREDIO_URL"
    }
];

export default {

    async fetch(request, env) {

        const url = new URL(request.url);


        // ====================================================
        // API
        // ====================================================

        if (url.pathname === "/api/estado") {

            const resultados = await Promise.all(
                FUENTES.map(fuente => revisarFuente(fuente, env))
            );

            return respuestaJSON({
                generado: new Date().toISOString(),
                cantidad: resultados.length,
                archivos: resultados
            });
        }


        // ====================================================
        // ARCHIVOS ESTÁTICOS
        // ====================================================

        return env.ASSETS.fetch(request);
    }
};


// ============================================================
// REVISAR UNA FUENTE
// ============================================================

async function revisarFuente(fuente, env) {

    const urlDropbox = env[fuente.variable];


    // --------------------------------------------------------
    // SECRET NO CONFIGURADO
    // --------------------------------------------------------

    if (!urlDropbox) {

        return {
            nombre: fuente.nombre,
            actualizado: null,
            estado: "ERROR",
            detalle: `Falta configurar ${fuente.variable}`
        };
    }


    try {

        // ----------------------------------------------------
        // DESCARGAR JSON
        // ----------------------------------------------------

        const respuesta = await fetch(
            urlDropbox.trim(),
            {
                method: "GET",
                redirect: "follow",

                headers: {
                    "Accept": "application/json,text/plain,*/*",
                    "User-Agent": "Cloudflare-Worker"
                },

                cf: {
                    cacheTtl: 0,
                    cacheEverything: false
                }
            }
        );


        if (!respuesta.ok) {

            return {
                nombre: fuente.nombre,
                actualizado: null,
                estado: "ERROR",
                detalle: `HTTP ${respuesta.status}`
            };
        }


        // ----------------------------------------------------
        // LEER CONTENIDO
        // ----------------------------------------------------

        const texto = await respuesta.text();

        let datos;


        try {

            datos = JSON.parse(texto);

        } catch {

            return {
                nombre: fuente.nombre,
                actualizado: null,
                estado: "ERROR",
                detalle: "JSON inválido"
            };
        }


        // ----------------------------------------------------
        // BUSCAR CAMPO ACTUALIZADO
        // ----------------------------------------------------

        const actualizado = buscarFechaActualizacion(datos);


        if (!actualizado) {

            return {
                nombre: fuente.nombre,
                actualizado: null,
                estado: "SIN FECHA",
                detalle: "No se encontró el campo actualizado"
            };
        }


        return {
            nombre: fuente.nombre,
            actualizado: actualizado,
            estado: "OK",
            detalle: null
        };


    } catch (error) {

        return {
            nombre: fuente.nombre,
            actualizado: null,
            estado: "ERROR",
            detalle:
                error instanceof Error
                    ? error.message
                    : String(error)
        };
    }
}


// ============================================================
// BUSCAR FECHA DE ACTUALIZACIÓN
// ============================================================

function buscarFechaActualizacion(datos) {

    if (!datos) return null;


    // --------------------------------------------------------
    // SI ES OBJETO
    // --------------------------------------------------------

    if (
        typeof datos === "object" &&
        !Array.isArray(datos)
    ) {

        const posiblesCampos = [

            "actualizado",
            "Actualizado",
            "ACTUALIZADO",

            "actualizacion",
            "Actualizacion",
            "ACTUALIZACION",

            "fechaActualizacion",
            "fecha_actualizacion",

            "ultimaActualizacion",
            "ultima_actualizacion",

            "ultimoGuardado",
            "ultimo_guardado"
        ];


        for (const campo of posiblesCampos) {

            if (
                datos[campo] !== undefined &&
                datos[campo] !== null &&
                String(datos[campo]).trim() !== ""
            ) {

                return String(datos[campo]).trim();
            }
        }


        // ----------------------------------------------------
        // BUSCAR RECURSIVAMENTE
        // ----------------------------------------------------

        for (const valor of Object.values(datos)) {

            if (
                valor &&
                typeof valor === "object"
            ) {

                const encontrado =
                    buscarFechaActualizacion(valor);

                if (encontrado) {
                    return encontrado;
                }
            }
        }
    }


    // --------------------------------------------------------
    // SI ES ARRAY
    // --------------------------------------------------------

    if (Array.isArray(datos)) {

        for (const item of datos.slice(0, 20)) {

            const encontrado =
                buscarFechaActualizacion(item);

            if (encontrado) {
                return encontrado;
            }
        }
    }


    return null;
}


// ============================================================
// RESPUESTA JSON
// ============================================================

function respuestaJSON(datos) {

    return new Response(
        JSON.stringify(datos),
        {
            status: 200,

            headers: {
                "Content-Type":
                    "application/json; charset=utf-8",

                "Cache-Control":
                    "no-store, no-cache, must-revalidate",

                "Pragma":
                    "no-cache",

                "Expires":
                    "0",

                "X-Content-Type-Options":
                    "nosniff"
            }
        }
    );
}
