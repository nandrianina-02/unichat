import { describe, expect, it } from "vitest";
import { conversationDirecte, type MessageServeur, type Moi } from "@unichat/shared";
import { env } from "cloudflare:workers";
import { decodeProtectedHeader, importJWK, jwtVerify } from "jose";
import { base64url, chiffrer, clePubliqueVapid, depuisBase64url, enteteVapid, serviceAutorise } from "../src/lib/push";
import { identite, preparer } from "./outils";

type Contexte = Awaited<ReturnType<typeof preparer>>;

async function personne(t: Contexte, prefixe: string) {
  const appareil = await t.connecter(identite(prefixe));
  const moi = (await (await appareil.appel("/api/moi", {
    method: "PATCH",
    json: { pseudo: `${prefixe}_${crypto.randomUUID().slice(0, 8)}` },
  })).json()) as Moi;
  return { appareil, id: moi.id };
}

const octets = (texte: string) => new Uint8Array(new TextEncoder().encode(texte));

async function hkdf(sel: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, n: number) {
  const cle = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: sel, info }, cle, n * 8));
}

/** Ce que fait le navigateur à l'arrivée (RFC 8291), pour vérifier le chiffrement de bout en bout. */
async function dechiffrer(corps: Uint8Array<ArrayBuffer>, cles: CryptoKeyPair, publique: Uint8Array<ArrayBuffer>, secret: Uint8Array<ArrayBuffer>) {
  const sel = corps.slice(0, 16);
  const longueur = corps[20]!;
  const serveur = corps.slice(21, 21 + longueur);
  const chiffre = corps.slice(21 + longueur);
  const cleServeur = await crypto.subtle.importKey("raw", serveur, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const partage = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: cleServeur } as unknown as SubtleCryptoDeriveKeyAlgorithm, cles.privateKey, 256),
  );
  const info = new Uint8Array([...octets("WebPush: info\0"), ...publique, ...serveur]);
  const ikm = await hkdf(secret, partage, info, 32);
  const cek = await hkdf(sel, ikm, octets("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(sel, ikm, octets("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const clair = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, aes, chiffre));
  expect(clair[clair.length - 1]).toBe(2);
  return new TextDecoder().decode(clair.slice(0, -1));
}

describe("Web Push", () => {
  it("chiffre pour l'appareil seul : il retrouve le contenu, personne d'autre", async () => {
    const cles = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    const publique = new Uint8Array((await crypto.subtle.exportKey("raw", cles.publicKey)) as ArrayBuffer);
    const secret = crypto.getRandomValues(new Uint8Array(16));
    const contenu = JSON.stringify({ titre: "Ana", corps: "Rendez-vous à 19 h", conversation: "d:x" });
    const corps = await chiffrer(octets(contenu), { p256dh: base64url(publique), auth: base64url(secret) });
    expect(new TextDecoder().decode(corps)).not.toContain("Rendez-vous");
    expect(await dechiffrer(corps, cles, publique, secret)).toBe(contenu);
  });

  it("signe l'en-tête VAPID pour le service visé", async () => {
    const jwk = JSON.parse(env.VAPID_PRIVEE!) as JsonWebKey & { x: string; y: string };
    const entete = await enteteVapid("https://fcm.googleapis.com/fcm/send/abc", jwk, "mailto:test@exemple.mg", Date.now());
    const [, jeton, k] = /^vapid t=([^,]+), k=(.+)$/.exec(entete)!;
    expect(k).toBe(clePubliqueVapid(jwk));
    expect(decodeProtectedHeader(jeton!).alg).toBe("ES256");
    const { d: _, key_ops: __, ...publique } = jwk as typeof jwk & { key_ops?: string[] };
    const { payload } = await jwtVerify(jeton!, await importJWK(publique, "ES256"));
    expect(payload).toMatchObject({ aud: "https://fcm.googleapis.com", sub: "mailto:test@exemple.mg" });
    expect(depuisBase64url(k!).length).toBe(65);
  });

  it("n'accepte que les services de notification connus", () => {
    expect(serviceAutorise("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(serviceAutorise("https://updates.push.services.mozilla.com/wpush/v2/abc")).toBe(true);
    expect(serviceAutorise("https://exemple.mg/collecte")).toBe(false);
    expect(serviceAutorise("http://fcm.googleapis.com/fcm/send/abc")).toBe(false);
  });

  it("notifie l'appareil abonné, oublie l'abonnement disparu, et se tait pour une discussion en sourdine", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const bob = await personne(t, "bob");
    const cles = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    const p256dh = base64url(new Uint8Array((await crypto.subtle.exportKey("raw", cles.publicKey)) as ArrayBuffer));
    const auth = base64url(crypto.getRandomValues(new Uint8Array(16)));

    expect((await ana.appareil.appel("/api/push/cle")).status).toBe(200);
    const refuse = await ana.appareil.appel("/api/push", { method: "POST", json: { endpoint: "https://exemple.mg/x", keys: { p256dh, auth } } });
    expect(refuse.status).toBe(400);

    const abonner = (endpoint: string) => ana.appareil.appel("/api/push", { method: "POST", json: { endpoint, keys: { p256dh, auth } } });
    const compter = async () =>
      (await env.DB.prepare("SELECT COUNT(*) AS n FROM abonnements_push WHERE utilisateur_id = ?1").bind(ana.id).first<{ n: number }>())!.n;
    const attendre = async (condition: () => Promise<boolean>) => {
      for (let i = 0; i < 40; i++) {
        if (await condition()) return true;
        await new Promise((r) => setTimeout(r, 50));
      }
      return false;
    };

    // Discussion en sourdine : l'abonnement « disparu » n'est pas sollicité, il reste.
    expect((await abonner("https://fcm.googleapis.com/fcm/send/disparu")).status).toBe(201);
    const conversation = conversationDirecte(ana.id, bob.id);
    const wsAna = await ana.appareil.tempsReel();
    if (wsAna.refus !== null) throw new Error("connexion refusée");
    wsAna.envoyer({ t: "bonjour", depuis: null });
    await wsAna.attendre((m): m is Extract<MessageServeur, { t: "lot" }> => m.t === "lot");
    wsAna.envoyer({ t: "preference", conversation, preference: { muetJusqua: Date.now() + 3600_000 } });
    await wsAna.attendre((m): m is Extract<MessageServeur, { t: "entree" }> => m.t === "entree" && m.entree.type === "preference");
    wsAna.ws.close();

    const wsBob = await bob.appareil.tempsReel();
    if (wsBob.refus !== null) throw new Error("connexion refusée");
    wsBob.envoyer({ t: "envoyer", id: crypto.randomUUID(), a: ana.id, texte: "Pendant la sourdine" });
    await wsBob.attendre((m): m is Extract<MessageServeur, { t: "accepte" }> => m.t === "accepte");
    expect(await attendre(async () => (await compter()) === 0)).toBe(false);

    // Son rétabli : la notification part, le service répond 410, l'abonnement disparaît.
    const wsAna2 = await ana.appareil.tempsReel();
    if (wsAna2.refus !== null) throw new Error("connexion refusée");
    wsAna2.envoyer({ t: "preference", conversation, preference: { muetJusqua: null } });
    await wsAna2.attendre((m): m is Extract<MessageServeur, { t: "entree" }> => m.t === "entree" && m.entree.type === "preference");
    wsBob.envoyer({ t: "envoyer", id: crypto.randomUUID(), a: ana.id, texte: "Tu es là ?" });
    expect(await attendre(async () => (await compter()) === 0)).toBe(true);
  });
});
