const JSON_HEADERS = {
  "Content-Type": "application/json; charset=UTF-8",
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  "Pragma": "no-cache",
  "Expires": "0"
};

function respuestaJSON(objeto, status = 200) {
  return new Response(JSON.stringify(objeto), {
    status,
    headers: JSON_HEADERS
  });
}

export default {
  async fetch(request, env) {

    const url = new URL(request.url);

    // ============================================================
    // SOLO ATENDER RUTAS /api/*
    // ============================================================

    if (!url.pathname.startsWith("/api/")) {
      return new Response("Not Found", {
        status: 404
      });
    }

    // Ejemplo:
    // /api/muestras-cierre
    // devuelve:
    // muestras-cierre

    const clave = url.pathname
      .slice("/api/".length)
      .replace(/^\/+|\/+$/g, "");

    if (!clave) {
      return respuestaJSON(
        {
          error: "Fuente no especificada."
        },
        400
      );
    }

    // ============================================================
    // LEER SECRET DE CLOUDFLARE
    // ============================================================

    if (!env.DROPBOX_SOURCES) {
      return respuestaJSON(
        {
          error: "No existe el Secret DROPBOX_SOURCES."
        },
        500
      );
    }

    let fuentes;

    try {

      fuentes = JSON.parse(env.DROPBOX_SOURCES);

    } catch (error) {

      return respuestaJSON(
        {
          error: "El Secret DROPBOX_SOURCES no contiene JSON válido."
        },
        500
      );
    }

    // ============================================================
    // BUSCAR FUENTE SOLICITADA
    // ============================================================

    const origen = fuentes[clave];

    if (!origen) {
      return respuestaJSON(
        {
          error: "Fuente no encontrada.",
          fuente: clave
        },
        404
      );
    }

    // ============================================================
    // CONSULTAR DROPBOX DESDE CLOUDFLARE
    // ============================================================

    try {

      const separador = origen.includes("?") ? "&" : "?";

      const upstream =
        origen +
        separador +
        "_=" +
        Date.now();

      const respuesta = await fetch(upstream, {
        method: "GET",
        redirect: "follow",
        headers: {
          "Accept": "application/json,text/plain,*/*",
          "User-Agent": "ultimo-guardado-worker"
        }
      });

      if (!respuesta.ok) {

        return respuestaJSON(
          {
            error: "No se pudo consultar la fuente.",
            fuente: clave,
            status: respuesta.status
          },
          502
        );
      }

      const cuerpo = await respuesta.text();

      // ============================================================
      // VALIDAR QUE DROPBOX DEVOLVIÓ JSON
      // ============================================================

      try {

        JSON.parse(cuerpo);

      } catch (error) {

        return respuestaJSON(
          {
            error: "La fuente devolvió contenido que no es JSON válido.",
            fuente: clave
          },
          502
        );
      }

      // ============================================================
      // DEVOLVER JSON AL INDEX
      // ============================================================

      return new Response(cuerpo, {
        status: 200,
        headers: JSON_HEADERS
      });

    } catch (error) {

      return respuestaJSON(
        {
          error: "Error consultando la fuente.",
          fuente: clave,
          detalle:
            error instanceof Error
              ? error.message
              : String(error)
        },
        502
      );
    }
  }
};
