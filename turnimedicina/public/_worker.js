// ─── TurniMedicina — _worker.js (Cloudflare Pages, v0.3.15) ──────────────────
// Da copiare DENTRO la cartella dist/ prima del caricamento su Cloudflare
// Pages (deploy con trascinamento). Intercetta /api/stato e lo serve da
// Workers KV; tutto il resto passa ai file statici del sito.
//
// Richiede un KV namespace collegato al progetto Pages col nome "TURNI"
// (vedi ISTRUZIONI-CONDIVISIONE.md).

const CHIAVI = ["stato", "regole", "ambRot"];

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (url.pathname === "/api/stato") {
      if (!env.TURNI) {
        return new Response(
          'KV non collegato: aggiungi il binding "TURNI" nelle impostazioni del progetto Pages.',
          { status: 500 },
        );
      }

      if (req.method === "GET") {
        const [stato, regole, ambRot] = await Promise.all(
          CHIAVI.map((k) => env.TURNI.get(k)),
        );
        return Response.json({
          stato:  stato  ? JSON.parse(stato)  : null,
          regole: regole ? JSON.parse(regole) : null,
          ambRot: ambRot ? JSON.parse(ambRot) : null,
        }, { headers: { "Cache-Control": "no-store" } });
      }

      if (req.method === "PUT") {
        let corpo;
        try { corpo = await req.json(); } catch { corpo = null; }
        if (!corpo || !CHIAVI.includes(corpo.id) || corpo.dati === undefined)
          return new Response("richiesta non valida", { status: 400 });
        await env.TURNI.put(corpo.id, JSON.stringify(corpo.dati));
        return Response.json({ ok: true });
      }

      return new Response("metodo non supportato", { status: 405 });
    }

    // Tutto il resto: file statici dell'app.
    return env.ASSETS.fetch(req);
  },
};
