import * as XLSX from "xlsx";

// ============================================================
// CONFIGURACIÓN DE ARCHIVOS
// ============================================================

const ARCHIVOS = [
    {
        nombre: "ENVÍO DE CORREOS",
        hoja: null,
        celda: "I1",
        buscarEnTodasLasHojas: true,
        url: "https://dl.dropbox.com/scl/fi/l87boeiqu54yra3i0evd6/aENVIO-DE-CORREOS.xlsb?rlkey=149gw31ntsbso8vtpix30yxjl&dl=1"
    },
    {
        nombre: "DESCARGA POLO",
        hoja: "Hoja1",
        celda: "A1",
        buscarEnTodasLasHojas: false,
        url: "https://dl.dropbox.com/scl/fi/a6cv8r5dcc85x10ztxzd0/DESCARGA-POLO.xlsm?rlkey=1f0s6ysc4og0l8b6q7mq4a1mc&dl=1"
    },
    {
        nombre: "MUESTRAS ONLINE",
        hoja: "Hoja3",
        celda: "B1",
        buscarEnTodasLasHojas: false,
        url: "https://dl.dropbox.com/scl/fi/vxlc0xscum4y2smwudxm7/MUESTRAS-online.xlsm?rlkey=uj0iwjahm9uapfdik3aduxbtn&dl=1"
    },
    {
        nombre: "PILAS ONLINE",
        hoja: "Hoja2",
        celda: "A1",
        buscarEnTodasLasHojas: false,
        url: "https://dl.dropbox.com/scl/fi/9ocvyfhxi5lj1o8gxz8f0/PilasOnline.xlsm?rlkey=e4gh5o7sxno32u0nk1webl25r&dl=1"
    },
    {
        nombre: "CONSULTAS SISTEMA",
        hoja: "Hoja2",
        celda: "A1",
        buscarEnTodasLasHojas: false,
        url: "https://dl.dropbox.com/scl/fi/9i03jw9jkxuxjic11geef/CONSULTAS-SISTEMA.xlsm?rlkey=jky2kmdl0159904ytat5j9v66&dl=1"
    },
    {
        nombre: "PLANILLA JAUSER",
        hoja: "DATOS_PARA_IMPORTAR",
        celda: "B1",
        buscarEnTodasLasHojas: false,
        url: "https://dl.dropbox.com/scl/fi/abxg80f8tb8947ruszwz9/PLANILLA-JAUSER.xlsb?rlkey=99iedhq9pfexfev568boeg3nl&dl=1"
    },
    {
        nombre: "PLANILLA",
        hoja: "DATOS_PARA_IMPORTAR",
        celda: "E1",
        buscarEnTodasLasHojas: false,
        url: "https://dl.dropbox.com/scl/fi/j47cweyd63abyn7fb741i/PLANILLA.xlsb?rlkey=vjhsdaa5s4jocma2g8cwl5njo&dl=1"
    },
    {
        nombre: "AGREGAR CONDUCTORES A REMITO SP",
        hoja: "RECIBO",
        celda: "R1",
        buscarEnTodasLasHojas: false,
        url: "https://dl.dropbox.com/scl/fi/8r7iugu2bvcmstfwfwutv/AGREGAR-CONDUCTORES-A-REMITO-SP.xlsm?rlkey=f10ete2nh3hvwbnwq6p79ejbn&dl=1"
    }
];

// Todos los archivos alertan al superar este tiempo.
const LIMITE_ALERTA_MINUTOS = 30;

// ============================================================
// WORKER
// ============================================================

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        // Permite probar manualmente desde:
        // https://ultimo-guardado.fas-uy.workers.dev/api/probar-alerta
        if (url.pathname === "/api/probar-alerta") {
            try {
                const resultado = await revisarArchivos(env);

                return respuestaJson({
                    correcto: true,
                    ...resultado
                });
            } catch (error) {
                return respuestaJson(
                    {
                        correcto: false,
                        error: error.message
                    },
                    500
                );
            }
        }

        // Mantiene funcionando el dashboard web.
        return env.ASSETS.fetch(request);
    },

    async scheduled(controller, env, ctx) {
        ctx.waitUntil(revisarArchivos(env));
    }
};

// ============================================================
// REVISIÓN GENERAL
// ============================================================

async function revisarArchivos(env) {
    validarVariables(env);

    const resultados = await Promise.all(
        ARCHIVOS.map(async archivo => {
            try {
                const fechaActualizacion = await obtenerFechaArchivo(archivo);

                const minutosTranscurridos = Math.floor(
                    (Date.now() - fechaActualizacion.getTime()) / 60000
                );

                return {
                    nombre: archivo.nombre,
                    correcto: true,
                    fechaActualizacion,
                    minutosTranscurridos,
                    vencido: minutosTranscurridos > LIMITE_ALERTA_MINUTOS
                };
            } catch (error) {
                return {
                    nombre: archivo.nombre,
                    correcto: false,
                    error: error.message,
                    vencido: true
                };
            }
        })
    );

    const vencidos = resultados.filter(item => item.vencido);

    if (vencidos.length > 0) {
        await enviarCorreoAlerta(env, vencidos);
    }

    console.log(
        JSON.stringify({
            fechaRevision: new Date().toISOString(),
            cantidadArchivos: resultados.length,
            cantidadVencidos: vencidos.length,
            resultados
        })
    );

    return {
        fechaRevision: new Date().toISOString(),
        cantidadArchivos: resultados.length,
        cantidadVencidos: vencidos.length,
        resultados
    };
}

// ============================================================
// DESCARGAR Y LEER EXCEL
// ============================================================

async function obtenerFechaArchivo(archivo) {
    const respuesta = await fetch(agregarAntiCache(archivo.url), {
        method: "GET",
        redirect: "follow",
        headers: {
            "User-Agent": "Cloudflare-Worker-Ultimo-Guardado"
        }
    });

    if (!respuesta.ok) {
        throw new Error(`Error HTTP ${respuesta.status}`);
    }

    const datos = await respuesta.arrayBuffer();

    const libro = XLSX.read(datos, {
        type: "array",
        cellDates: true,
        cellNF: true,
        cellText: true
    });

    const lectura = leerCeldaExacta(libro, archivo);

    if (!lectura.fecha) {
        throw new Error(
            `No se pudo interpretar la fecha de ${lectura.hoja}!${archivo.celda}`
        );
    }

    return lectura.fecha;
}

function agregarAntiCache(urlOriginal) {
    const url = new URL(urlOriginal);

    url.searchParams.set("dl", "1");
    url.searchParams.set("_", Date.now().toString());

    return url.toString();
}

function leerCeldaExacta(libro, archivo) {
    if (archivo.buscarEnTodasLasHojas) {
        for (const nombreHoja of libro.SheetNames) {
            const hoja = libro.Sheets[nombreHoja];
            const celda = hoja?.[archivo.celda];
            const valor = obtenerValorMostrado(celda);

            if (valor !== "") {
                return {
                    valor,
                    hoja: nombreHoja,
                    fecha: convertirAFecha(celda, valor)
                };
            }
        }

        throw new Error(
            `La celda ${archivo.celda} está vacía en todas las hojas`
        );
    }

    const hoja = libro.Sheets[archivo.hoja];

    if (!hoja) {
        throw new Error(`No existe la hoja ${archivo.hoja}`);
    }

    const celda = hoja[archivo.celda];
    const valor = obtenerValorMostrado(celda);

    if (valor === "") {
        throw new Error(
            `La celda ${archivo.hoja}!${archivo.celda} está vacía`
        );
    }

    return {
        valor,
        hoja: archivo.hoja,
        fecha: convertirAFecha(celda, valor)
    };
}

function obtenerValorMostrado(celda) {
    if (!celda) return "";

    let valor;

    if (
        celda.w !== undefined &&
        celda.w !== null &&
        String(celda.w).trim() !== ""
    ) {
        valor = String(celda.w);
    } else if (celda.v instanceof Date) {
        valor = formatearFechaUruguay(celda.v);
    } else if (celda.v !== undefined && celda.v !== null) {
        valor = String(celda.v);
    } else {
        valor = "";
    }

    return limpiarTextoActualizacion(valor);
}

function limpiarTextoActualizacion(texto) {
    return String(texto || "")
        .replace(/^\s*Act\.\s*:\s*/i, "")
        .replace(/^\s*Actualizado\s*:\s*/i, "")
        .trim();
}

function convertirAFecha(celda, valorMostrado) {
    if (!celda) return null;

    if (
        celda.v instanceof Date &&
        !Number.isNaN(celda.v.getTime())
    ) {
        return celda.v;
    }

    if (typeof celda.v === "number") {
        const partes = XLSX.SSF.parse_date_code(celda.v);

        if (partes) {
            return crearFechaUruguay(
                partes.y,
                partes.m,
                partes.d,
                partes.H || 0,
                partes.M || 0,
                Math.floor(partes.S || 0)
            );
        }
    }

    const texto = limpiarTextoActualizacion(
        valorMostrado || celda.v || ""
    );

    const coincidencia = texto.match(
        /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
    );

    if (coincidencia) {
        let anio = Number(coincidencia[3]);

        if (anio < 100) {
            anio += 2000;
        }

        return crearFechaUruguay(
            anio,
            Number(coincidencia[2]),
            Number(coincidencia[1]),
            Number(coincidencia[4] || 0),
            Number(coincidencia[5] || 0),
            Number(coincidencia[6] || 0)
        );
    }

    const fechaGenerica = new Date(texto);

    return Number.isNaN(fechaGenerica.getTime())
        ? null
        : fechaGenerica;
}

// Uruguay es UTC-3.
// Esta función interpreta la fecha del Excel como hora de Uruguay.
function crearFechaUruguay(
    anio,
    mes,
    dia,
    hora,
    minuto,
    segundo
) {
    const fechaIso =
        `${String(anio).padStart(4, "0")}-` +
        `${String(mes).padStart(2, "0")}-` +
        `${String(dia).padStart(2, "0")}T` +
        `${String(hora).padStart(2, "0")}:` +
        `${String(minuto).padStart(2, "0")}:` +
        `${String(segundo).padStart(2, "0")}-03:00`;

    const fecha = new Date(fechaIso);

    return Number.isNaN(fecha.getTime()) ? null : fecha;
}

// ============================================================
// ENVÍO DE CORREO
// ============================================================

async function enviarCorreoAlerta(env, vencidos) {
    const asunto =
        vencidos.length === 1
            ? `ALERTA: ${vencidos[0].nombre} sin actualizar`
            : `ALERTA: ${vencidos.length} archivos sin actualizar`;

    const filas = vencidos.map(item => {
        if (!item.correcto) {
            return `
                <tr>
                    <td>${escaparHtml(item.nombre)}</td>
                    <td style="color:#b42318;font-weight:700">
                        Error de lectura
                    </td>
                    <td>${escaparHtml(item.error)}</td>
                </tr>
            `;
        }

        return `
            <tr>
                <td>${escaparHtml(item.nombre)}</td>
                <td style="color:#b42318;font-weight:700">
                    ${item.minutosTranscurridos} minutos
                </td>
                <td>
                    ${escaparHtml(
                        formatearFechaUruguay(item.fechaActualizacion)
                    )}
                </td>
            </tr>
        `;
    }).join("");

    const html = `
        <!DOCTYPE html>
        <html lang="es">
        <body style="font-family:Arial,Helvetica,sans-serif;color:#202630">
            <h2 style="color:#b42318">
                Alerta de archivos sin actualizar
            </h2>

            <p>
                Los siguientes archivos superaron el límite de
                <strong>${LIMITE_ALERTA_MINUTOS} minutos</strong>
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
                    <tr style="background:#eaf0f6">
                        <th style="padding:10px;border:1px solid #d9dee5">
                            Archivo
                        </th>
                        <th style="padding:10px;border:1px solid #d9dee5">
                            Tiempo
                        </th>
                        <th style="padding:10px;border:1px solid #d9dee5">
                            Última actualización
                        </th>
                    </tr>
                </thead>

                <tbody>
                    ${filas}
                </tbody>
            </table>

            <p style="margin-top:20px;color:#667085">
                Próxima comprobación automática dentro de 30 minutos.
            </p>

            <p style="color:#667085">
                Revisión realizada:
                ${escaparHtml(formatearFechaUruguay(new Date()))}
            </p>
        </body>
        </html>
    `;

    const destinatarios = env.EMAIL_DESTINO
        .split(",")
        .map(email => email.trim())
        .filter(Boolean);

    const respuesta = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${env.RESEND_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            from: env.EMAIL_REMITENTE,
            to: destinatarios,
            subject: asunto,
            html
        })
    });

    const contenido = await respuesta.text();

    if (!respuesta.ok) {
        throw new Error(
            `Resend respondió HTTP ${respuesta.status}: ${contenido}`
        );
    }

    console.log("Correo enviado correctamente:", contenido);
}

// ============================================================
// FUNCIONES AUXILIARES
// ============================================================

function validarVariables(env) {
    const faltantes = [];

    if (!env.RESEND_API_KEY) faltantes.push("RESEND_API_KEY");
    if (!env.EMAIL_DESTINO) faltantes.push("EMAIL_DESTINO");
    if (!env.EMAIL_REMITENTE) faltantes.push("EMAIL_REMITENTE");

    if (faltantes.length > 0) {
        throw new Error(
            `Faltan variables de entorno: ${faltantes.join(", ")}`
        );
    }
}

function formatearFechaUruguay(fecha) {
    return new Intl.DateTimeFormat("es-UY", {
        timeZone: "America/Montevideo",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
    }).format(fecha);
}

function escaparHtml(texto) {
    return String(texto ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function respuestaJson(datos, estado = 200) {
    return new Response(JSON.stringify(datos, null, 2), {
        status: estado,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store"
        }
    });
}
