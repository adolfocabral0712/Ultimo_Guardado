// ============================================================
// CONFIGURACIÓN GENERAL
// ============================================================

const URL_JSON_DROPBOX =
    "https://dl.dropbox.com/scl/fi/9ts4dhfsqh6lhi49kdvf2/UltimoGuardado.json?rlkey=j4t4r35xlorh62pzrknxbwynw&dl=1";

const LIMITE_ALERTA_MINUTOS = 30;

// Mismo horario utilizado por la macro de Excel.
// Fuera de este horario no envía alertas.
const HORA_INICIO_URUGUAY = 5;
const MINUTO_INICIO_URUGUAY = 30;
const HORA_FIN_URUGUAY = 22;

// ============================================================
// WORKER PRINCIPAL
// ============================================================

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        // Devuelve el JSON procesado para el dashboard.
        if (url.pathname === "/api/estado") {
            try {
                const resultado = await revisarArchivos(env, false);

                return respuestaJSON(
                    {
                        correcto: true,
                        ...resultado
                    },
                    200
                );
            } catch (error) {
                return respuestaJSON(
                    {
                        correcto: false,
                        error: error.message
                    },
                    500
                );
            }
        }

        // Prueba manual y envío inmediato si hay vencidos.
        if (url.pathname === "/api/probar-alerta") {
            try {
                const resultado = await revisarArchivos(env, true);

                return respuestaJSON(
                    {
                        correcto: true,
                        pruebaManual: true,
                        ...resultado
                    },
                    200
                );
            } catch (error) {
                return respuestaJSON(
                    {
                        correcto: false,
                        error: error.message
                    },
                    500
                );
            }
        }

        // Mantiene visible el dashboard.
        return env.ASSETS.fetch(request);
    },

    async scheduled(controller, env, ctx) {
        ctx.waitUntil(ejecutarRevisionProgramada(env));
    }
};

// ============================================================
// EJECUCIÓN PROGRAMADA
// ============================================================

async function ejecutarRevisionProgramada(env) {
    if (!estaDentroDelHorarioUruguay()) {
        console.log(
            JSON.stringify({
                estado: "FUERA_DE_HORARIO",
                fecha: new Date().toISOString()
            })
        );

        return;
    }

    try {
        const resultado = await revisarArchivos(env, true);

        console.log(
            JSON.stringify({
                estado: "REVISION_COMPLETADA",
                ...resultado
            })
        );
    } catch (error) {
        console.error(
            JSON.stringify({
                estado: "ERROR",
                fecha: new Date().toISOString(),
                error: error.message
            })
        );

        throw error;
    }
}

// ============================================================
// REVISAR JSON
// ============================================================

async function revisarArchivos(env, enviarCorreo) {
    const datos = await descargarJSON();

    if (
        !datos ||
        !Array.isArray(datos.archivos)
    ) {
        throw new Error(
            "El JSON no contiene una lista válida en la propiedad archivos."
        );
    }

    const ahora = new Date();

    const resultados = datos.archivos.map(archivo => {
        const limiteMinutos =
            Number(archivo.limiteMinutos) ||
            Number(datos.limiteAlertaMinutos) ||
            LIMITE_ALERTA_MINUTOS;

        if (
            archivo.estadoLectura !== "OK" ||
            !archivo.actualizado
        ) {
            return {
                nombre: archivo.nombre || "Archivo sin nombre",
                actualizado: archivo.actualizado || null,
                hoja: archivo.hoja || "",
                celda: archivo.celda || "",
                limiteMinutos,
                minutosTranscurridos: null,
                vencido: true,
                estadoLectura: archivo.estadoLectura || "ERROR",
                error:
                    archivo.error ||
                    "No se pudo obtener una fecha válida."
            };
        }

        const fechaActualizacion = new Date(archivo.actualizado);

        if (Number.isNaN(fechaActualizacion.getTime())) {
            return {
                nombre: archivo.nombre || "Archivo sin nombre",
                actualizado: archivo.actualizado,
                hoja: archivo.hoja || "",
                celda: archivo.celda || "",
                limiteMinutos,
                minutosTranscurridos: null,
                vencido: true,
                estadoLectura: "ERROR",
                error: "La fecha del JSON no es válida."
            };
        }

        const diferenciaMilisegundos =
            ahora.getTime() - fechaActualizacion.getTime();

        const minutosTranscurridos = Math.floor(
            diferenciaMilisegundos / 60000
        );

        return {
            nombre: archivo.nombre,
            actualizado: archivo.actualizado,
            hoja: archivo.hoja || "",
            celda: archivo.celda || "",
            limiteMinutos,
            minutosTranscurridos,
            vencido:
                minutosTranscurridos > limiteMinutos &&
                minutosTranscurridos >= 0,
            estadoLectura: "OK",
            error: null
        };
    });

    const vencidos = resultados.filter(
        archivo => archivo.vencido
    );

    let correoEnviado = false;

    if (enviarCorreo && vencidos.length > 0) {
        validarVariablesCorreo(env);
        await enviarCorreoAlerta(env, vencidos);
        correoEnviado = true;
    }

    return {
        generado: datos.generado || null,
        fechaRevision: ahora.toISOString(),
        limiteAlertaMinutos:
            Number(datos.limiteAlertaMinutos) ||
            LIMITE_ALERTA_MINUTOS,
        cantidadArchivos: resultados.length,
        cantidadVencidos: vencidos.length,
        correoEnviado,
        archivos: resultados
    };
}

// ============================================================
// DESCARGAR JSON DE DROPBOX
// ============================================================

async function descargarJSON() {
    const url = new URL(URL_JSON_DROPBOX);

    url.searchParams.set("dl", "1");
    url.searchParams.set("_", Date.now().toString());

    const respuesta = await fetch(url.toString(), {
        method: "GET",
        redirect: "follow",
        headers: {
            "Cache-Control": "no-cache, no-store",
            "Pragma": "no-cache"
        }
    });

    if (!respuesta.ok) {
        throw new Error(
            `Dropbox respondió HTTP ${respuesta.status}.`
        );
    }

    const texto = await respuesta.text();

    try {
        return JSON.parse(texto);
    } catch (error) {
        throw new Error(
            "Dropbox respondió, pero el contenido no es un JSON válido."
        );
    }
}

// ============================================================
// ENVIAR CORREO MEDIANTE RESEND
// ============================================================

async function enviarCorreoAlerta(env, vencidos) {
    const asunto =
        vencidos.length === 1
            ? `ALERTA: ${vencidos[0].nombre} sin actualizar`
            : `ALERTA: ${vencidos.length} archivos sin actualizar`;

    const filas = vencidos
        .map(archivo => {
            let tiempo;
            let actualizacion;
            let detalle;

            if (archivo.estadoLectura !== "OK") {
                tiempo = "Error de lectura";
                actualizacion = "Sin fecha válida";
                detalle = archivo.error || "";
            } else {
                tiempo = formatearTiempo(
                    archivo.minutosTranscurridos
                );

                actualizacion = formatearFechaUruguay(
                    new Date(archivo.actualizado)
                );

                detalle =
                    `Límite: ${archivo.limiteMinutos} minutos`;
            }

            return `
                <tr>
                    <td style="${estiloCelda()}">
                        <strong>${escaparHTML(archivo.nombre)}</strong>
                    </td>

                    <td style="${estiloCelda()} color:#b42318; font-weight:700;">
                        ${escaparHTML(tiempo)}
                    </td>

                    <td style="${estiloCelda()}">
                        ${escaparHTML(actualizacion)}
                    </td>

                    <td style="${estiloCelda()}">
                        ${escaparHTML(detalle)}
                    </td>
                </tr>
            `;
        })
        .join("");

    const html = `
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
        </head>

        <body
            style="
                margin:0;
                padding:24px;
                background:#f3f5f7;
                font-family:Arial,Helvetica,sans-serif;
                color:#202630;
            "
        >
            <div
                style="
                    max-width:850px;
                    margin:auto;
                    background:#ffffff;
                    border:1px solid #d9dee5;
                    border-radius:12px;
                    overflow:hidden;
                "
            >
                <div
                    style="
                        padding:20px 24px;
                        background:#fee2e2;
                        border-bottom:1px solid #fecaca;
                    "
                >
                    <h2
                        style="
                            margin:0;
                            color:#991b1b;
                        "
                    >
                        Alerta de archivos sin actualizar
                    </h2>
                </div>

                <div style="padding:24px;">
                    <p style="margin-top:0;">
                        Los siguientes archivos superaron el límite
                        de <strong>${LIMITE_ALERTA_MINUTOS} minutos</strong>
                        sin actualización.
                    </p>

                    <table
                        style="
                            width:100%;
                            border-collapse:collapse;
                            margin-top:18px;
                        "
                    >
                        <thead>
                            <tr style="background:#eaf0f6;">
                                <th style="${estiloEncabezado()}">
                                    Archivo
                                </th>

                                <th style="${estiloEncabezado()}">
                                    Tiempo transcurrido
                                </th>

                                <th style="${estiloEncabezado()}">
                                    Última actualización
                                </th>

                                <th style="${estiloEncabezado()}">
                                    Detalle
                                </th>
                            </tr>
                        </thead>

                        <tbody>
                            ${filas}
                        </tbody>
                    </table>

                    <p
                        style="
                            margin:22px 0 0;
                            color:#667085;
                            font-size:13px;
                        "
                    >
                        Revisión realizada:
                        ${escaparHTML(formatearFechaUruguay(new Date()))}
                    </p>

                    <p
                        style="
                            margin:8px 0 0;
                            color:#667085;
                            font-size:13px;
                        "
                    >
                        Mientras continúe el atraso, se enviará otra
                        alerta en la siguiente revisión de 30 minutos.
                    </p>
                </div>
            </div>
        </body>
        </html>
    `;

    const destinatarios = env.EMAIL_DESTINO
        .split(",")
        .map(valor => valor.trim())
        .filter(Boolean);

    const respuesta = await fetch(
        "https://api.resend.com/emails",
        {
            method: "POST",
            headers: {
                "Authorization":
                    `Bearer ${env.RESEND_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                from: env.EMAIL_REMITENTE,
                to: destinatarios,
                subject: asunto,
                html
            })
        }
    );

    const contenido = await respuesta.text();

    if (!respuesta.ok) {
        throw new Error(
            `Resend respondió HTTP ${respuesta.status}: ${contenido}`
        );
    }

    console.log(
        JSON.stringify({
            estado: "CORREO_ENVIADO",
            cantidadVencidos: vencidos.length,
            respuestaResend: contenido
        })
    );
}

// ============================================================
// HORARIO DE URUGUAY
// ============================================================

function estaDentroDelHorarioUruguay() {
    const partes = new Intl.DateTimeFormat(
        "en-US",
        {
            timeZone: "America/Montevideo",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
        }
    ).formatToParts(new Date());

    const hora = Number(
        partes.find(parte => parte.type === "hour")?.value || 0
    );

    const minuto = Number(
        partes.find(parte => parte.type === "minute")?.value || 0
    );

    const minutosActuales = hora * 60 + minuto;
    const minutosInicio =
        HORA_INICIO_URUGUAY * 60 +
        MINUTO_INICIO_URUGUAY;
    const minutosFin = HORA_FIN_URUGUAY * 60;

    return (
        minutosActuales >= minutosInicio &&
        minutosActuales < minutosFin
    );
}

// ============================================================
// FUNCIONES AUXILIARES
// ============================================================

function validarVariablesCorreo(env) {
    const faltantes = [];

    if (!env.RESEND_API_KEY) {
        faltantes.push("RESEND_API_KEY");
    }

    if (!env.EMAIL_DESTINO) {
        faltantes.push("EMAIL_DESTINO");
    }

    if (!env.EMAIL_REMITENTE) {
        faltantes.push("EMAIL_REMITENTE");
    }

    if (faltantes.length > 0) {
        throw new Error(
            "Faltan variables de entorno: " +
            faltantes.join(", ")
        );
    }
}

function formatearFechaUruguay(fecha) {
    return new Intl.DateTimeFormat(
        "es-UY",
        {
            timeZone: "America/Montevideo",
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false
        }
    ).format(fecha);
}

function formatearTiempo(minutosTotales) {
    if (
        minutosTotales === null ||
        minutosTotales === undefined
    ) {
        return "Sin información";
    }

    const dias = Math.floor(minutosTotales / 1440);
    const horas = Math.floor(
        (minutosTotales % 1440) / 60
    );
    const minutos = minutosTotales % 60;

    if (dias > 0) {
        return `${dias} d ${horas} h ${minutos} min`;
    }

    if (horas > 0) {
        return `${horas} h ${minutos} min`;
    }

    return `${minutos} min`;
}

function escaparHTML(texto) {
    return String(texto ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function estiloCelda() {
    return (
        "padding:10px;" +
        "border:1px solid #d9dee5;" +
        "text-align:left;"
    );
}

function estiloEncabezado() {
    return (
        "padding:10px;" +
        "border:1px solid #d9dee5;" +
        "text-align:left;" +
        "font-size:13px;"
    );
}

function respuestaJSON(datos, estado) {
    return new Response(
        JSON.stringify(datos, null, 2),
        {
            status: estado,
            headers: {
                "Content-Type":
                    "application/json; charset=utf-8",
                "Cache-Control":
                    "no-store, no-cache, must-revalidate"
            }
        }
    );
}
